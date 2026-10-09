#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list, MAX_SCANNED } from '#scripts/gh/git-gh-issue-list'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { github_issue_url } from '#scripts/gh/github-issue-url'
import { cli_flags } from '#scripts/lib/cli-flags'
import { error_text } from '#scripts/lib/error-message'
import { repository_labels } from '#scripts/repo/repository-labels'
import { RELEASE_LABEL } from './issue-labels'
import { issue_release } from './issue-release'
import { session_cite } from './session-cite'

// `josh issue:release <N>` — link Issue `<N>` to its repository's release Issue as a `blocked_by`
// blocker, filing the release Issue when none is open. `josh issue:file
// --release` calls the same `link` once its Issue exists, so a new and an existing Issue are linked
// by one body of code.
//
// The relation is written through `issue_add_blocked_by`, which addresses the repository `gh`
// resolves — the current one, or the target a cross-repository `issue:file` has pointed `GH_REPO` at.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ARGV_OFFSET = 2
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh issue:release <issue-number>'
const NONE = 'none'
const UNKNOWN_REPO_MESSAGE =
	'Could not read this repository from `git remote` — check `gh auth status`.'

interface ReleaseIssue {
	issue_number: number
	// Filed by this call, rather than found open.
	is_filed: boolean
}

// `undefined` when the listing is unreadable, `NONE` when it reads and names no open release Issue.
async function find_open(target: string): Promise<number | typeof NONE | undefined> {
	const outcome = await git_gh_issue_list.issue_list({
		json_fields: 'number',
		limit: MAX_SCANNED,
		label: RELEASE_LABEL,
		repo: target,
	})

	if (outcome.json === undefined) return undefined

	return issue_release.open_release_of(outcome.json) ?? NONE
}

// The new release Issue's number, or `undefined` when the create call failed. Never `auto-ok`: the
// labels are `RELEASE_LABELS`, decided here rather than by `issue_auto_ok`, which refuses the label too.
async function file_release(target: string): Promise<number | undefined> {
	repository_labels.ensure_labels(target)
	const request = git_gh_issue_write.issue_create_request({
		title: issue_release.title_of(target),
		body: issue_release.body_of(target),
		labels: issue_release.RELEASE_LABELS,
		repo: target,
	})

	try {
		const url = await git_gh_exec.exec_gh_api(request)
		const issue_number = Number(github_issue_url.parse(url)?.issue_number) || undefined

		if (issue_number === undefined) console.error(`✖ the release number is unreadable: ${url}`)

		return issue_number
	} catch (error) {
		console.error(`✖ the release Issue could not be filed: ${error_text.message_of(error)}`)

		return undefined
	}
}

// An unreadable listing files nothing: a second release Issue beside one the listing failed to show
// would split the blockers between two releases.
async function release_of(target: string): Promise<ReleaseIssue | undefined> {
	const open = await find_open(target)

	if (open === undefined) {
		console.error(`✖ the open ${RELEASE_LABEL} Issues of ${target} could not be listed`)

		return undefined
	}

	if (open !== NONE) return { issue_number: open, is_filed: false }
	const filed = await file_release(target)

	return filed === undefined ? undefined : { issue_number: filed, is_filed: true }
}

function linked_line(release: ReleaseIssue, issue_number: number, target: string): string {
	const how = release.is_filed ? 'filed' : 'open'
	const release_cite = session_cite.issue(release.issue_number, undefined, target)

	return `release: ${release_cite} (${how}) is blocked by ${session_cite.issue(issue_number, undefined, target)}`
}

function unlinked_line(issue_number: number, blocked: string, target: string): string {
	const blocker = session_cite.issue(issue_number, undefined, target)

	return `✖ ${blocker} could not be recorded as a blocker of ${session_cite.issue(blocked, undefined, target)}`
}

// Whether Issue `issue_number` of `target` now blocks the release Issue. Every outcome is printed.
async function link(issue_number: number, target: string): Promise<boolean> {
	const release = await release_of(target)

	if (release === undefined) return false
	const blocked = String(release.issue_number)
	const is_linked = await git_gh_issue_write.issue_add_blocked_by(blocked, String(issue_number))

	if (is_linked) console.info(linked_line(release, issue_number, target))
	else console.error(unlinked_line(issue_number, blocked, target))

	return is_linked
}

// An unknown flag parses to no positionals, so it refuses the call like a missing number.
function positionals_of(argv: ReadonlyArray<string>): ReadonlyArray<string> {
	return cli_flags.arguments_of(argv, {})?.positionals ?? []
}

// The number is the one positional: a missing, malformed or second one refuses the whole call.
function issue_number_of(argv: ReadonlyArray<string>): number | undefined {
	const [issue_number, ...rest] = positionals_of(argv)
	const is_single = rest.length === 0 && issue_number !== undefined

	return is_single && ISSUE_NUMBER_PATTERN.test(issue_number) ? Number(issue_number) : undefined
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = issue_number_of(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const current = await git_gh_command.repo_get_name_with_owner()

	if (current === undefined) {
		console.error(UNKNOWN_REPO_MESSAGE)

		return FAILURE_EXIT_CODE
	}

	return (await link(issue_number, current)) ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

// `process.exitCode` rather than `process.exit()`, so the report on standard output drains first.
async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_release_cli = { link, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_release_cli }
