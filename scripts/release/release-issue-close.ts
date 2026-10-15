import { epic_issue } from '#scripts/epic/epic-issue'
import { epic_parse } from '#scripts/epic/epic-parse'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { epic_child_schema } from '#scripts/git/git-schemas'
import { parse_json_object_or_undefined } from '#scripts/git/parse-json-array'
import { issue_release_cli } from '#scripts/issue/issue-release-cli'
import { session_cite } from '#scripts/issue/session-cite'

// Closes the repository's open release Issue once `pnpm josh release` has published
// (joshuafolkken/kit#3825). Its body promises that, and an Issue waiting on the release reopens only
// once it closes; left open, it keeps naming published work as unreleased.
//
// **Nothing here throws or changes the release's exit code.** The version is already out by the time
// this runs, so a close that fails is reported for a person to finish rather than read as a failed
// release.

function published_comment(version: string): string {
	return `Published in \`v${version}\` by \`pnpm josh release\`.`
}

// Resolved through `epic_issue.blocker_references_of`, so a blocker in another repository keeps that
// repository instead of reading as the same number here.
function open_references_of(
	json: string | undefined,
	repo: string,
): Array<IssueReference> | undefined {
	if (json === undefined) return undefined
	const parsed = parse_json_object_or_undefined(json, epic_child_schema)

	if (parsed === undefined) return undefined

	return epic_issue
		.blocker_references_of(parsed, repo)
		.filter((reference) => !epic_parse.is_state_closed(reference.state))
}

// The blockers still open at publish have not merged, so this release did not carry them.
// `undefined` when the relations are unreadable: closing then could strand a blocker on a closed
// release Issue that no open one tracks.
async function open_blockers_of(
	repo: string,
	issue_number: number,
): Promise<Array<IssueReference> | undefined> {
	const json = await git_gh_command.issue_get_state_and_relations(String(issue_number))

	try {
		return open_references_of(json, repo)
	} catch {
		return undefined
	}
}

// A release Issue tracks only its own repository's changes, so a blocker elsewhere is named for a
// person to carry rather than linked under a number that means a different Issue here.
function warn_foreign(repo: string, foreign: ReadonlyArray<IssueReference>): void {
	for (const reference of foreign) {
		const cite = session_cite.issue(reference.number, undefined, reference.repo)

		console.warn(`⚠ ${cite} is not in ${repo}, so it was not carried — carry it by hand`)
	}
}

// Each unmerged blocker joins the next release Issue — the first link files it, the rest find it
// open — so an open release Issue still names every change no release has published.
async function carry_forward(repo: string, blockers: ReadonlyArray<IssueReference>): Promise<void> {
	const own = blockers.filter((blocker) => blocker.repo === repo)

	warn_foreign(
		repo,
		blockers.filter((blocker) => blocker.repo !== repo),
	)

	for (const blocker of own) {
		// eslint-disable-next-line no-await-in-loop -- the first link files the Issue the rest join
		await issue_release_cli.link(blocker.number, repo)
	}
}

async function close_and_carry(
	repo: string,
	issue_number: number,
	version: string,
	blockers: ReadonlyArray<IssueReference>,
): Promise<void> {
	const cite = `release Issue ${session_cite.issue(issue_number, undefined, repo)}`
	const is_closed = await git_gh_command.issue_close(
		String(issue_number),
		published_comment(version),
	)

	if (!is_closed) {
		console.warn(`⚠ ${cite} could not be closed — close it by hand`)

		return
	}

	console.info(`${cite} closed (v${version})`)
	await carry_forward(repo, blockers)
}

async function close_issue(repo: string, issue_number: number, version: string): Promise<void> {
	const blockers = await open_blockers_of(repo, issue_number)

	if (blockers === undefined) {
		const cite = session_cite.issue(issue_number, undefined, repo)

		console.warn(`⚠ the blockers of release Issue ${cite} could not be read, so it was left open`)

		return
	}

	await close_and_carry(repo, issue_number, version, blockers)
}

async function close_published(version: string): Promise<void> {
	const repo = await git_gh_command.repo_get_name_with_owner()

	if (repo === undefined) {
		console.warn('⚠ the repository is unreadable, so its release Issue was left open')

		return
	}

	const open = await issue_release_cli.find_open(repo)

	if (open === undefined) console.warn(`⚠ the release Issues of ${repo} could not be listed`)
	else if (typeof open === 'number') await close_issue(repo, open, version)
}

const release_issue_close = { close_published }

export { release_issue_close }
