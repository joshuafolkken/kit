import { fileURLToPath } from 'node:url'
import { gh_spawn } from '#scripts/gh/gh-spawn'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite, type CiteTarget } from '#scripts/issue/issue-cite'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { acceptance_map } from '#scripts/review/acceptance-map'
import { acceptance_map_defer } from '#scripts/review/acceptance-map-defer'

// `josh issue:defer` marks a criterion moved to another issue — of this repository, or of another one
// named `owner/repo#N` — and makes that issue carry the criterion's identifier so the merge can see it
// was taken over (joshuafolkken/kit#9146).

const USAGE = 'Usage: josh issue:defer <issue-number> <ac-id> <target> <reason...>'
const FAILURE = 1
const ARGV_OFFSET = 2
// <issue> <ac-id> <target>, then at least one word of reason.
const REASON_INDEX = 3

interface DeferRequest {
	issue: string
	id: string
	target: CiteTarget
	reason: string
}

function target_of(raw: string, issue: string): CiteTarget {
	const target = issue_cite.parse_target(raw, undefined)

	if (target === undefined || !issue_number_shape.is_issue_number(target.number)) {
		throw new Error(USAGE)
	}

	// A self-target would overwrite its own reference line with the mark, which the merge then refuses.
	if (target.repo === undefined && target.number === issue) {
		throw new Error('josh issue:defer: the target must be another issue')
	}

	return target
}

function positionals_of(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	const parsed = cli_flags.arguments_of(argv, {})

	if (parsed === undefined || parsed.positionals.length <= REASON_INDEX) throw new Error(USAGE)

	return parsed.positionals
}

function request_of(argv: ReadonlyArray<string>): DeferRequest {
	const [issue = '', id = '', target = '', ...reason] = positionals_of(argv)

	if (!issue_number_shape.is_issue_number(issue)) throw new Error(USAGE)

	return { issue, id, target: target_of(target, issue), reason: reason.join(' ') }
}

function target_name(target: CiteTarget): string {
	// `undefined` falls back to this repository.
	return session_cite.issue(target.number, undefined, target.repo)
}

async function read_body(target: CiteTarget): Promise<string> {
	const body = await git_gh_command.issue_get_body(target.number, target.repo)

	if (body === undefined) throw new Error(`Could not read ${target_name(target)}`)

	return body
}

// A reference line landing in another repository names its source as `owner/repo#N`.
function source_repo(target: CiteTarget): string {
	if (target.repo === undefined) return ''
	const slug = gh_spawn.get_repo_name_with_owner()

	if (slug === undefined) throw new Error('josh issue:defer: could not resolve this repository')

	return slug
}

async function carry(request: DeferRequest, repo: string): Promise<void> {
	const { target } = request
	const target_body = await read_body(target)

	if (acceptance_map_defer.carries(target_body, request.id)) return
	const line = acceptance_map_defer.reference_line(request.issue, request.id, request.reason, repo)
	const updated = `${target_body.trimEnd()}\n\n${line}\n`

	await git_gh_command.issue_edit_body(target.number, updated, target.repo)
}

// The mark and the source repository are computed first, so an unknown identifier or an unresolved
// repository is refused before either issue is written.
async function apply(request: DeferRequest): Promise<void> {
	const body = await read_body({ number: request.issue, repo: undefined })
	const { number, repo: target_repo = '' } = request.target
	const updated = acceptance_map.defer(
		body,
		request.id,
		issue_cite.plain_for('github', number, target_repo),
	)
	const repo = source_repo(request.target)

	await carry(request, repo)
	if (updated !== body) await git_gh_command.issue_edit_body(request.issue, updated)
	console.info(`Acceptance criterion ${request.id} deferred to ${target_name(request.target)}`)
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
