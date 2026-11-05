import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { acceptance_map } from '#scripts/review/acceptance-map'

const USAGE = 'Usage: josh issue:tick <issue-number> <ac-id>...'
const FAILURE = 1
const ARGV_OFFSET = 2

interface TickRequest {
	issue: string
	ids: ReadonlyArray<string>
}

function request_of(argv: ReadonlyArray<string>): TickRequest {
	const parsed = cli_flags.arguments_of(argv, {})

	if (parsed === undefined) throw new Error(USAGE)
	const [issue = '', ...ids] = parsed.positionals

	if (!issue_number_shape.is_issue_number(issue) || ids.length === 0) throw new Error(USAGE)

	return { issue, ids }
}

async function apply(request: TickRequest): Promise<void> {
	const body = await git_gh_command.issue_get_body(request.issue)

	if (body === undefined) throw new Error(`Could not read ${session_cite.issue(request.issue)}`)
	const updated = acceptance_map.tick(body, request.ids)

	if (updated !== body) await git_gh_command.issue_edit_body(request.issue, updated)
	console.info(`Acceptance criteria checked: ${request.ids.join(', ')}`)
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

const issue_tick_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_tick_cli }
