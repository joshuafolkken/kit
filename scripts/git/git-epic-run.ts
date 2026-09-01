import { git_epic_body } from './git-epic-body'
import { git_epic_promote } from './git-epic-promote'
import { git_epic_relations } from './git-epic-relations'
import { git_epic_validate, type EpicSubject } from './git-epic-validate'
import { git_gh_command } from './git-gh-command'
import { EPIC_LABEL } from './issue-labels'

const EPIC_LABEL_COLOR = '#5319e7'
const EPIC_LABEL_DESCRIPTION = 'Tracks a batch of child issues from one split'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0

interface CreateEpicInput {
	title: string
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	origin?: string | undefined
}

// The relations the declared order implies, applied through the shared module `--add` also uses so
// the two cannot drift. A failure is reported and stepped over rather than aborting a batch that is
// otherwise fine — see `git-epic-relations.ts` for why the relation is not part of the contract.
async function apply_dependencies(input: {
	children: ReadonlyArray<number>
	is_ordered: boolean
}): Promise<void> {
	const pairs = git_epic_body.build_dependency_pairs(input.children, input.is_ordered)
	if (pairs.length === 0) return

	const failures = await git_epic_relations.apply_relations(pairs, 'record')

	console.info(
		git_epic_relations.format_relation_report({
			total: pairs.length,
			failures,
			action: 'record',
		}),
	)
}

// The epic's own number, from the URL `gh issue create` prints. Needed because the run command in
// the body names the epic, and the number only exists once the issue does.
const ISSUE_URL_NUMBER = /\/(?<number>\d+)\s*$/u

function parse_created_number(url: string): number | undefined {
	const { groups } = ISSUE_URL_NUMBER.exec(url.trim()) ?? {}
	const { number: raw } = groups ?? {}
	if (raw === undefined) return undefined
	const parsed = Number(raw)

	return Number.isSafeInteger(parsed) ? parsed : undefined
}

// Rewrite the body once the number is known, so `## Execution` carries a command that can be run as
// written rather than a placeholder. A failure here costs the substitution and nothing else — the
// epic and its task list are already correct, and nothing machine-readable lives in that section.
async function fill_run_command(
	epic_number: number | undefined,
	input: CreateEpicInput,
): Promise<void> {
	if (epic_number === undefined) {
		console.info(
			`⚠️  Could not read the new epic's number from its URL; the Execution section still says \`${git_epic_body.format_run_command(undefined)}\`.`,
		)

		return
	}

	try {
		await git_gh_command.issue_edit_body(
			String(epic_number),
			git_epic_body.build_epic_body({
				children: input.children,
				rationale: input.rationale,
				is_ordered: input.is_ordered,
				origin: input.origin,
				epic_number,
			}),
		)
	} catch {
		console.info('⚠️  Could not substitute the epic number into the Execution section.')
	}
}

async function create_epic(input: CreateEpicInput): Promise<number> {
	await git_gh_command.label_ensure({
		name: EPIC_LABEL,
		color: EPIC_LABEL_COLOR,
		description: EPIC_LABEL_DESCRIPTION,
	})

	const body = git_epic_body.build_epic_body({
		children: input.children,
		rationale: input.rationale,
		is_ordered: input.is_ordered,
		origin: input.origin,
	})

	const url = await git_gh_command.issue_create_with_label({
		title: input.title,
		label: EPIC_LABEL,
		body,
	})
	const epic_number = parse_created_number(url)

	console.info(`📋 Created epic: ${url}`)
	await apply_dependencies({ children: input.children, is_ordered: input.is_ordered })
	await fill_run_command(epic_number, input)
	console.info(`▶ Run the children with: ${git_epic_body.format_run_command(epic_number)}`)

	return SUCCESS_EXIT_CODE
}

interface PromoteEpicInput {
	epic_number: number
	children: ReadonlyArray<number>
	rationale: string
	is_ordered: boolean
	origin?: string | undefined
}

// The issue being promoted, or the reason it cannot be. Refused when it already carries the epic
// sections — a second append would give the auto-close two task lists to disagree about.
async function read_promotion_subject(epic_number: number): Promise<EpicSubject | undefined> {
	const subject = git_epic_validate.parse_epic_subject(
		await git_gh_command.issue_get_labels_and_body(String(epic_number)),
	)

	if (subject === undefined) {
		console.error(`✖ Could not read issue #${String(epic_number)}.`)

		return undefined
	}

	if (git_epic_promote.has_conflicting_tracking(subject.body)) {
		const reason = git_epic_promote.conflict_reason(subject.body)

		console.error(`✖ Cannot promote #${String(epic_number)}: ${reason}.`)

		return undefined
	}

	return subject
}

// Write the promoted body and apply the label. The label is what `git-epic-close.ts` filters on, so
// an unlabelled issue is one the auto-close skips forever — a failure there is reported rather than
// logged past.
async function write_promotion(
	input: PromoteEpicInput,
	existing_body: string | undefined,
): Promise<number> {
	const body = git_epic_promote.build_promoted_body({ ...input, body: existing_body })

	const tracking_error = git_epic_promote.find_tracking_error(body, input.children)

	if (tracking_error !== undefined) {
		console.error(`✖ ${tracking_error}`)

		return FAILURE_EXIT_CODE
	}

	await git_gh_command.issue_edit_body(String(input.epic_number), body)

	if (await git_gh_command.issue_add_label(String(input.epic_number), EPIC_LABEL)) {
		return SUCCESS_EXIT_CODE
	}

	console.error(
		`✖ Wrote the epic sections to #${String(input.epic_number)} but could not apply the \`${EPIC_LABEL}\` label; apply it by hand.`,
	)

	return FAILURE_EXIT_CODE
}

// Promote an existing issue into an epic: append the epic sections, apply the label, and record the
// dependency relations exactly as a new epic would.
async function promote_epic(input: PromoteEpicInput): Promise<number> {
	const subject = await read_promotion_subject(input.epic_number)
	if (subject === undefined) return FAILURE_EXIT_CODE

	await git_gh_command.label_ensure({
		name: EPIC_LABEL,
		color: EPIC_LABEL_COLOR,
		description: EPIC_LABEL_DESCRIPTION,
	})
	const written = await write_promotion(input, subject.body)
	if (written !== SUCCESS_EXIT_CODE) return written

	console.info(`📋 Promoted #${String(input.epic_number)} to an epic.`)
	await apply_dependencies({ children: input.children, is_ordered: input.is_ordered })
	console.info(`▶ Run the children with: ${git_epic_body.format_run_command(input.epic_number)}`)

	return SUCCESS_EXIT_CODE
}

async function check_epic(epic_number: number): Promise<number> {
	const raw = await git_gh_command.issue_get_labels_and_body(String(epic_number))
	const subject = git_epic_validate.parse_epic_subject(raw)

	if (subject === undefined) {
		console.error(`✖ Could not read issue #${String(epic_number)}.`)

		return FAILURE_EXIT_CODE
	}

	const results = git_epic_validate.validate_epic(subject)

	console.info(git_epic_validate.format_check_report(subject.number, results))

	return git_epic_validate.is_epic_valid(results) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const git_epic_run = {
	parse_created_number,
	create_epic,
	promote_epic,
	check_epic,
}

export { git_epic_run, EPIC_LABEL_COLOR, EPIC_LABEL_DESCRIPTION, FAILURE_EXIT_CODE }
export type { CreateEpicInput, PromoteEpicInput }
