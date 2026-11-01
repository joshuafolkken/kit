import { fileURLToPath } from 'node:url'
import { epic_blocked_by } from '#scripts/epic/epic-blocked-by'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_cite } from '#scripts/issue/issue-cite'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_run_verdict } from '#scripts/issue/issue-run-verdict'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { run_park } from '#scripts/run/park/run-park'

// `josh backlog:triage --apply <N> [--lane | --solo] [--blocked-by <M>] --reason <text> [--clear]` —
// backlogrun's triage verdict on one issue in one call (joshuafolkken/kit#5636): the park taken off when
// `--clear` says its question is answered, the native `blocked-by` relation on `#M`
// (joshuafolkken/kit#5647), the reason commented, then the run label — at least one of the relation
// and the label. The flags and the label write are `auto-ok:judge --apply`'s (`issue_run_verdict`);
// the clear is `run:park --clear`'s; the relation is `run:pause`'s (`epic_blocked_by`), so an epic
// tracking `#N` declares it too.
//
// **The park comes off only on `--clear`**: an issue left for a person's judgement keeps
// `needs-decision`, so labelling it never lets `backlog:next` offer an unanswered question.
// **The relation lands before the comment**: it is the write an epic can refuse, and it reads back
// what is already recorded, so the comment never names a relation that was refused and a rerun after
// a later failure records nothing twice.
// **The reason lands before the label**, as `auto-ok:judge`'s judgement does: a label failing after the
// comment leaves the verdict on record for the re-run, never a label nobody can trace back.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh backlog:triage --apply <N> [--lane | --solo] [--blocked-by <M>] --reason <text> [--clear]'

const OPTIONS = {
	apply: { type: 'string' },
	...issue_run_verdict.RUN_LABEL_OPTIONS,
	'blocked-by': { type: 'string' },
	reason: { type: 'string' },
	clear: { type: 'boolean' },
} as const

interface TriageRequest {
	issue: string
	run_label: string | undefined
	blocker: string | undefined
	reason: string
	is_clearing: boolean
}

type Values = NonNullable<ReturnType<typeof cli_flags.values_of<typeof OPTIONS>>>

// A `--blocked-by` given has to name another issue.
function is_blocker_valid(issue: string, blocker: string | undefined): boolean {
	if (blocker === undefined) return true

	return issue_number_shape.is_issue_number(blocker) && blocker !== issue
}

// `--lane` with `--solo` is no answer, even beside a valid blocker.
function is_flags_valid(issue: string, values: Values, blocker: string | undefined): boolean {
	return is_blocker_valid(issue, blocker) && !(values.lane === true && values.solo === true)
}

// The verdict needs a run label, a blocker, or both.
function verdict_request(issue: string, values: Values, reason: string): TriageRequest | undefined {
	const blocker = values['blocked-by']

	if (!is_flags_valid(issue, values, blocker)) return undefined

	const run_label = issue_run_verdict.run_label_of(values)

	return run_label === undefined && blocker === undefined
		? undefined
		: { issue, run_label, blocker, reason, is_clearing: values.clear === true }
}

function labelled_request(issue: string, values: Values): TriageRequest | undefined {
	const reason = values.reason?.trim() ?? ''

	return reason === '' ? undefined : verdict_request(issue, values, reason)
}

function request_of(values: Values): TriageRequest | undefined {
	const issue = values.apply ?? ''

	return issue_number_shape.is_issue_number(issue) ? labelled_request(issue, values) : undefined
}

function parse_request(argv: ReadonlyArray<string>): TriageRequest | undefined {
	const values = cli_flags.values_of(argv, OPTIONS)

	return values === undefined ? undefined : request_of(values)
}

function refused(issue: string, problem: string): number {
	console.error(`${session_cite.issue(issue)}: ${problem}`)

	return FAILURE_EXIT_CODE
}

// `run:park --clear`'s two writes; its CLI is not imported, since a module with a main guard is never
// imported (`main-guard-boundary.test.ts`).
async function clear_park(request: TriageRequest, directory: string): Promise<boolean> {
	if (!request.is_clearing) return true

	run_park.clear(request.issue, directory)

	return await git_gh_issue_write.issue_clear_label(request.issue, NEEDS_DECISION_LABEL)
}

// The verdict's parts in one line: the run label, then the blocker — whichever were given. `cite`
// names the blocker for where the line lands: the comment GitHub links, or the session.
function verdict_of(request: TriageRequest, cite: (issue: string) => string): string {
	const label_part = request.run_label === undefined ? [] : [`\`${request.run_label}\``]
	const blocker_part = request.blocker === undefined ? [] : [`blocked by ${cite(request.blocker)}`]

	return [...label_part, ...blocker_part].join(' · ')
}

async function comment(request: TriageRequest): Promise<boolean> {
	try {
		await git_gh_command.issue_comment(
			request.issue,
			`triaged by backlogrun: ${verdict_of(request, issue_cite.plain)}\n\n${request.reason}`,
		)

		return true
	} catch {
		return false
	}
}

// The problem, or `undefined` once the relation is recorded (or none was asked for).
async function link_blocker(
	issue: string,
	blocker: string | undefined,
): Promise<string | undefined> {
	if (blocker === undefined) return undefined

	try {
		await epic_blocked_by.record({ issue, prerequisite: blocker })

		return undefined
	} catch (error) {
		return `could not record blocked by ${session_cite.issue(blocker)}: ${error_text.message_of(error)}`
	}
}

// The relation, the comment, then the label — the problem of the first that fails, or `undefined`.
async function write_verdict(request: TriageRequest): Promise<string | undefined> {
	const { issue, run_label } = request
	const link_problem = await link_blocker(issue, request.blocker)

	if (link_problem !== undefined) return link_problem

	if (!(await comment(request))) return 'could not comment the reason'

	return await issue_run_verdict.apply_labels(issue, run_label === undefined ? [] : [run_label])
}

async function triage(request: TriageRequest, directory: string): Promise<number> {
	const { issue } = request

	if (!(await clear_park(request, directory))) return refused(issue, 'could not clear the park')

	const problem = await write_verdict(request)

	if (problem !== undefined) return refused(issue, problem)

	console.info(`triage ${session_cite.issue(issue)} — ${verdict_of(request, session_cite.issue)}`)

	return SUCCESS_EXIT_CODE
}

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	const request = parse_request(argv)

	if (request !== undefined) return await triage(request, directory)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

// `process.exitCode` rather than `process.exit()`, so the report on standard output drains first.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const backlog_triage_cli = { USAGE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { backlog_triage_cli }
