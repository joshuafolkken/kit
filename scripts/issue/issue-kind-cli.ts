import { fileURLToPath } from 'node:url'
import { pr_classification } from '#scripts/ci/pr-classification'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_body_keys, type IssueBodyValue } from '#scripts/issue/issue-body-keys'
import { issue_bug_label } from '#scripts/issue/issue-bug-label'
import { issue_classification } from '#scripts/issue/issue-classification'
import { issue_declaration_line } from '#scripts/issue/issue-declaration-line'
import { has_label_name, IN_PROGRESS_LABEL, OTHER_CHANGE_LABEL } from '#scripts/issue/issue-labels'
import { issue_lint_cli } from '#scripts/issue/issue-lint-cli'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { z } from 'zod'

// `josh issue:kind <N> bug|non-bug …` — switch a filed Issue between defect and non-defect: the body's
// kind line and the declarations that go with it, then the `bug` / `enhancement` labels the body now
// derives, so the body and the labels never disagree (joshuafolkken/kit#7974).
const BUG = 'bug'
const NON_BUG = 'non-bug'
const UNKNOWN_ORIGIN = issue_body_keys.value_variants('unknown').join('|')
const USAGE = [
	`Usage: josh issue:kind <issue-number> ${BUG} --origin <#PR|${UNKNOWN_ORIGIN}（reason）>`,
	`       josh issue:kind <issue-number> ${NON_BUG} --purpose <feature|improvement|time-saving>`,
	`       josh issue:kind <issue-number> ${NON_BUG} --release-class ${OTHER_CHANGE_LABEL}`,
].join('\n')
const PURPOSES: ReadonlyMap<string, IssueBodyValue> = new Map([
	['feature', 'feature'],
	['improvement', 'improvement'],
	['time-saving', 'time_saving'],
])
const KIND_DECLARATIONS = issue_declaration_line.declaration_lines([
	'kind',
	'origin',
	'purpose',
	'release',
])
const OPTIONS = {
	origin: { type: 'string' },
	purpose: { type: 'string' },
	'release-class': { type: 'string' },
} as const
const LABEL = z.object({ name: z.string() })
const BODY = z.string().nullable()
const ISSUE = z.object({ labels: z.array(LABEL), body: BODY })
const TO_BUG_WARNING = `${IN_PROGRESS_LABEL}: commits on this Issue now need a regression test that fails before the fix.`
const TO_NON_BUG_WARNING = `${IN_PROGRESS_LABEL}: commits on this Issue no longer need a regression test that fails before the fix.`
const ARGUMENT_COUNT = 2
const FAILURE = 1
const ARGV_OFFSET = 2

interface KindValues {
	origin: string | undefined
	purpose: string | undefined
	release_class: string | undefined
}

interface KindRequest {
	issue: string
	to_bug: boolean
	lines: ReadonlyArray<string>
}

interface IssueState {
	body: string
	labels: ReadonlyArray<string>
}

function bug_lines(values: KindValues): ReadonlyArray<string> {
	const { origin, purpose, release_class } = values

	if (origin === undefined || purpose !== undefined || release_class !== undefined) {
		throw new Error(USAGE)
	}

	return [issue_body_keys.line('kind', 'bug'), `${issue_body_keys.prefix('origin')} ${origin}`]
}

function purpose_line(purpose: string): string {
	const value = PURPOSES.get(purpose)

	if (value === undefined) throw new Error(USAGE)

	return issue_body_keys.line('purpose', value)
}

function release_line(release_class: string | undefined): string {
	if (release_class !== OTHER_CHANGE_LABEL) throw new Error(USAGE)

	return pr_classification.declaration(OTHER_CHANGE_LABEL)
}

// A non-defect declares exactly one of a purpose and a release classification.
function non_bug_lines(values: KindValues): ReadonlyArray<string> {
	const { origin, purpose, release_class } = values

	if (origin !== undefined || (purpose === undefined) === (release_class === undefined)) {
		throw new Error(USAGE)
	}

	const declaration = purpose === undefined ? release_line(release_class) : purpose_line(purpose)

	return [issue_body_keys.line('kind', 'non_bug'), declaration]
}

function lines_of(kind: string, values: KindValues): ReadonlyArray<string> {
	if (kind === BUG) return bug_lines(values)
	if (kind === NON_BUG) return non_bug_lines(values)

	throw new Error(USAGE)
}

function issue_of(positionals: ReadonlyArray<string>): string {
	const [issue = ''] = positionals

	if (positionals.length !== ARGUMENT_COUNT || !issue_number_shape.is_issue_number(issue)) {
		throw new Error(USAGE)
	}

	return issue
}

function request_of(argv: ReadonlyArray<string>): KindRequest {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	if (parsed === undefined) throw new Error(USAGE)
	const issue = issue_of(parsed.positionals)
	const kind = parsed.positionals.at(-1) ?? ''
	const { origin, purpose, 'release-class': release_class } = parsed.values

	return { issue, to_bug: kind === BUG, lines: lines_of(kind, { origin, purpose, release_class }) }
}

async function read_issue(issue: string): Promise<IssueState> {
	const json = await git_gh_command.issue_get_labels_and_body(issue)

	if (json === undefined) throw new Error(`Could not read ${session_cite.issue(issue)}`)
	const parsed = ISSUE.parse(JSON.parse(json))

	return { body: parsed.body ?? '', labels: parsed.labels.map((label) => label.name) }
}

// The body already declaring exactly `lines` is kept as it is, so a repeat never moves its lines.
function updated_body(body: string, lines: ReadonlyArray<string>): string {
	const declared = issue_declaration_line.declared(body, KIND_DECLARATIONS)

	if (declared.join('\n') === lines.join('\n')) return body

	return issue_declaration_line.with_declaration_lines(body, KIND_DECLARATIONS, lines)
}

function labels_after(labels: ReadonlyArray<string>, body: string): ReadonlyArray<string> {
	const changes = issue_classification.kind_label_changes(body, labels)

	return [...labels.filter((label) => !changes.remove.includes(label)), ...changes.add]
}

function refusal(issue: string, found: ReadonlyArray<string>): string {
	const command = `pnpm josh issue:body ${issue} --body-file <path>`
	const next = `Nothing was written. Add the missing sections first with \`${command}\`, then re-run.`

	return [...found.map((problem) => `- ${problem}`), next].join('\n')
}

async function write_labels(
	issue: string,
	body: string,
	labels: ReadonlyArray<string>,
): Promise<void> {
	const { add, remove } = issue_classification.kind_label_changes(body, labels)
	const written = await Promise.all([
		...add.map(async (label) => await git_gh_command.issue_add_label(issue, label)),
		...remove.map(async (label) => await git_gh_command.issue_clear_label(issue, label)),
	])

	if (written.includes(false)) {
		throw new Error(
			`Could not update the labels of ${session_cite.issue(issue)}; re-run this command.`,
		)
	}
}

// The regression-test requirement a commit meets follows the body's kind, so a switch on an Issue in
// progress changes what its next commit needs.
function warn_in_progress(request: KindRequest, current: IssueState): void {
	if (
		!has_label_name(current.labels, IN_PROGRESS_LABEL) ||
		issue_bug_label.is_bug_fix(current.body) === request.to_bug
	) {
		return
	}

	console.warn(request.to_bug ? TO_BUG_WARNING : TO_NON_BUG_WARNING)
}

async function apply(request: KindRequest): Promise<void> {
	const current = await read_issue(request.issue)
	const body = updated_body(current.body, request.lines)
	const found = issue_lint_cli.problems(body, labels_after(current.labels, body))

	if (found.length > 0) throw new Error(refusal(request.issue, found))

	if (body !== current.body) await git_gh_command.issue_edit_body(request.issue, body)
	await write_labels(request.issue, body, current.labels)
	warn_in_progress(request, current)
	console.info(`Kind declared: ${request.to_bug ? BUG : NON_BUG}`)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	try {
		await apply(request_of(argv))

		return 0
	} catch (error) {
		console.error(error_text.message_of(error))

		return FAILURE
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_kind_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_kind_cli }
