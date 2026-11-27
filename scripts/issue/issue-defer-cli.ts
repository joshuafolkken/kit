import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { acceptance_map_defer } from '#scripts/review/acceptance-map-defer'

// `josh issue:defer` marks a criterion moved to another issue of this repository, and makes that issue
// carry the criterion's identifier so the merge can see it was taken over (joshuafolkken/kit#9146).

const USAGE = 'Usage: josh issue:defer <issue-number> <ac-id> #<target> <reason...>'
const FAILURE = 1
const ARGV_OFFSET = 2
const TARGET_PREFIX = '#'
// <issue> <ac-id> #<target>, then at least one word of reason.
const REASON_INDEX = 3

interface DeferRequest {
	issue: string
	id: string
	target: string
	reason: string
}

function target_number(raw: string): string {
	const number = raw.startsWith(TARGET_PREFIX) ? raw.slice(TARGET_PREFIX.length) : raw

	if (!issue_number_shape.is_issue_number(number)) throw new Error(USAGE)

	return number
}

function positionals_of(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	const parsed = cli_flags.arguments_of(argv, {})

	if (parsed === undefined || parsed.positionals.length <= REASON_INDEX) throw new Error(USAGE)

	return parsed.positionals
}

function request_of(argv: ReadonlyArray<string>): DeferRequest {
	const [issue = '', id = '', target = '', ...reason] = positionals_of(argv)

	if (!issue_number_shape.is_issue_number(issue)) throw new Error(USAGE)

	return { issue, id, target: target_number(target), reason: reason.join(' ') }
}

async function read_body(issue: string): Promise<string> {
	const body = await git_gh_command.issue_get_body(issue)

	if (body === undefined) throw new Error(`Could not read ${session_cite.issue(issue)}`)

	return body
}

async function carry(request: DeferRequest): Promise<void> {
	const target_body = await read_body(request.target)

	if (acceptance_map_defer.carries(target_body, request.id)) return
	const line = acceptance_map_defer.reference_line(request.issue, request.id, request.reason)

	await git_gh_command.issue_edit_body(request.target, `${target_body.trimEnd()}\n\n${line}\n`)
}

// The mark is computed first, so an unknown identifier is refused before either issue is written.
async function apply(request: DeferRequest): Promise<void> {
	const body = await read_body(request.issue)
	const target = issue_cite.plain_for('github', request.target)
	const updated = acceptance_map.defer(body, request.id, target)

	await carry(request)
	if (updated !== body) await git_gh_command.issue_edit_body(request.issue, updated)
	console.info(
		`Acceptance criterion ${request.id} deferred to ${session_cite.issue(request.target)}`,
	)
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

const issue_defer_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_defer_cli }
