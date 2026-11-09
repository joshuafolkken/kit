import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import { gh_request_tally, type CoreUsage } from '#scripts/gh/gh-request-tally'
import { gh_usage_event, type GhUsageContext } from '#scripts/gh/gh-usage-event'
import { git_gh_exec, type GhApiRequest } from '#scripts/gh/git-gh-exec'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'

// The josh entry's GitHub usage record (joshuafolkken/kit#6707): the core allowance is watched from
// the start, and the usage line is written once the command answers — before the entry turns
// an unknown command into `process.exit`, and even when the command throws. The command's answer is
// returned untouched, so the record never changes an exit code.

// The exit waits on the end reading, so a slow GitHub answer would hold every command that called
// gh: past this budget the reading is none and the line leaves the difference out.
const USAGE_READ_TIMEOUT_MS = 5000

type UsageWrite = (context: GhUsageContext) => Promise<void>
type UsageExec = (request: GhApiRequest) => Promise<string>

async function read_usage_bounded(
	exec: UsageExec = git_gh_exec.exec_gh_api_uncounted,
): Promise<CoreUsage | undefined> {
	return await gh_core_rate_limit.read_usage(
		async (request) => await exec({ ...request, timeout_ms: USAGE_READ_TIMEOUT_MS }),
	)
}

// The issue a command ran for is its first argument shaped as an issue number (`run:step 6707`).
function issue_of(subcommand_arguments: ReadonlyArray<string>): number | undefined {
	const issue = subcommand_arguments.find((token) => issue_number_shape.is_issue_number(token))

	return issue === undefined ? undefined : Number(issue)
}

async function recorded<T>(
	command: string,
	subcommand_arguments: ReadonlyArray<string>,
	run: () => Promise<T>,
	write: UsageWrite = gh_usage_event.write,
): Promise<T> {
	const context = { command, issue: issue_of(subcommand_arguments), started_ms: Date.now() }

	gh_request_tally.watch_core(read_usage_bounded)

	try {
		return await run()
	} finally {
		await write(context)
	}
}

const josh_gh_usage = { read_usage_bounded, recorded }

export { josh_gh_usage }
