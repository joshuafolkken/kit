import { git_epic_body } from './git-epic-body'
import { EPIC_LABEL, git_epic_validate, type EpicSubject } from './git-epic-validate'
import { git_gh_command } from './git-gh-command'
import { parse_json_object_safe } from './parse-json-array'
import { epic_subject_schema } from './schemas'

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

// The relation is a nicety, not part of the contract: `--add-blocked-by` needs gh >= 2.94.0 and
// losing it costs only the native link, while the Issue and its task list are already correct. A
// failure is therefore reported and stepped over rather than aborting a batch that is otherwise fine.
async function apply_dependency(pair: { blocked: number; blocker: number }): Promise<boolean> {
	return await git_gh_command.issue_add_blocked_by(String(pair.blocked), String(pair.blocker))
}

async function apply_dependencies(input: {
	children: ReadonlyArray<number>
	is_ordered: boolean
}): Promise<void> {
	const pairs = git_epic_body.build_dependency_pairs(input.children, input.is_ordered)
	if (pairs.length === 0) return

	const applied = await Promise.all(pairs.map(async (pair) => await apply_dependency(pair)))
	const failures = applied.filter((is_applied) => !is_applied).length

	console.info(
		failures === 0
			? `🔗 Recorded ${String(pairs.length)} blocked-by relation(s) along the declared order.`
			: `⚠️  ${String(failures)} of ${String(pairs.length)} blocked-by relation(s) could not be recorded (gh >= 2.94.0 required); the epic itself is intact.`,
	)
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

	console.info(`📋 Created epic: ${url}`)
	await apply_dependencies({ children: input.children, is_ordered: input.is_ordered })
	console.info(`▶ Run the children with: ${git_epic_body.format_queue_command(input.children)}`)

	return SUCCESS_EXIT_CODE
}

function to_epic_subject(raw_json: string | undefined): EpicSubject | undefined {
	if (raw_json === undefined) return undefined

	const parsed = parse_json_object_safe(raw_json, epic_subject_schema)
	if (parsed === undefined) return undefined

	return {
		number: parsed.number,
		labels: (parsed.labels ?? []).map((label) => label.name),
		body: parsed.body,
	}
}

async function check_epic(epic_number: number): Promise<number> {
	const raw = await git_gh_command.issue_get_labels_and_body(String(epic_number))
	const subject = to_epic_subject(raw)

	if (subject === undefined) {
		console.error(`✖ Could not read issue #${String(epic_number)}.`)

		return FAILURE_EXIT_CODE
	}

	const results = git_epic_validate.validate_epic(subject)

	console.info(git_epic_validate.format_check_report(subject.number, results))

	return git_epic_validate.is_epic_valid(results) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const git_epic_run = {
	create_epic,
	check_epic,
}

export { git_epic_run, EPIC_LABEL_COLOR, EPIC_LABEL_DESCRIPTION, FAILURE_EXIT_CODE }
export type { CreateEpicInput }
