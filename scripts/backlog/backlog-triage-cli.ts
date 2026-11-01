import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_run_verdict } from '#scripts/issue/issue-run-verdict'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_park } from '#scripts/run/park/run-park'

// `josh backlog:triage --apply <N> (--lane | --solo) --reason <text> [--clear]` — backlogrun's triage
// verdict on one issue in one call (joshuafolkken/kit#5636): the park taken off when `--clear` says its
// question is answered, the reason commented, then the run label. The flags and the label write are
// `auto-ok:judge --apply`'s (`issue_run_verdict`); the clear is `run:park --clear`'s.
//
// **The park comes off only on `--clear`**: an issue left for a person's judgement keeps
// `needs-decision`, so labelling it never lets `backlog:next` offer an unanswered question.
// **The reason lands before the label**, as `auto-ok:judge`'s judgement does: a label failing after the
// comment leaves the verdict on record for the re-run, never a label nobody can trace back.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE = 'Usage: josh backlog:triage --apply <N> (--lane | --solo) --reason <text> [--clear]'

const OPTIONS = {
	apply: { type: 'string' },
	...issue_run_verdict.RUN_LABEL_OPTIONS,
	reason: { type: 'string' },
	clear: { type: 'boolean' },
} as const

interface TriageRequest {
	issue: string
	run_label: string
	reason: string
	is_clearing: boolean
}

type Values = NonNullable<ReturnType<typeof cli_flags.values_of<typeof OPTIONS>>>

function labelled_request(issue: string, values: Values): TriageRequest | undefined {
	const reason = values.reason?.trim() ?? ''

	if (reason === '') return undefined

	const run_label = issue_run_verdict.run_label_of(values)

	return run_label === undefined
		? undefined
		: { issue, run_label, reason, is_clearing: values.clear === true }
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

async function comment(request: TriageRequest): Promise<boolean> {
	try {
		await git_gh_command.issue_comment(
			request.issue,
			`triaged by backlogrun: \`${request.run_label}\`\n\n${request.reason}`,
		)

		return true
	} catch {
		return false
	}
}

async function triage(request: TriageRequest, directory: string): Promise<number> {
	const { issue, run_label } = request

	if (!(await clear_park(request, directory))) return refused(issue, 'could not clear the park')

	if (!(await comment(request))) return refused(issue, 'could not comment the reason')

	const problem = await issue_run_verdict.apply_labels(issue, [run_label])

	if (problem !== undefined) return refused(issue, problem)

	console.info(`triage ${session_cite.issue(issue)} — ${run_label}`)

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
