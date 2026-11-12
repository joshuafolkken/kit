import { git_gh_repo } from '#scripts/gh/git-gh-repo'
import { issue_release_cli, NONE } from '#scripts/issue/issue-release-cli'
import { session_cite } from '#scripts/issue/session-cite'

// The release request a run closes its completion report with once `release:scope` answers
// `required`. The open release Issue is looked up by `issue_release_cli.find_open` — the one search
// `issue:release` and `pnpm josh release` share — so the run never lists it with a raw `gh api`.
const UNKNOWN = 'unknown'
const RELEASE_COMMAND = 'run `pnpm josh release` on the default branch of the primary checkout'

type OpenRelease = number | typeof NONE | undefined

interface ReleaseRequestLines {
	release_issue: string
	request: string
}

// `undefined` (the listing or the repository was unreadable) reports `unknown`, never `none`: a
// request that drops the release Issue the listing failed to show cites nothing a person can close.
function request_of(open: OpenRelease, target: string): ReleaseRequestLines {
	if (open === undefined) return { release_issue: UNKNOWN, request: `request: ${RELEASE_COMMAND}` }

	if (open === NONE) return { release_issue: NONE, request: `request: ${RELEASE_COMMAND}` }

	// The number-link, not a bare `#N`: both lines are printed to the session as they are.
	const cite = session_cite.issue(open, undefined, target)

	return { release_issue: cite, request: `request: ${RELEASE_COMMAND} — it closes ${cite}` }
}

async function read(): Promise<ReleaseRequestLines> {
	const target = await git_gh_repo.repo_get_name_with_owner()

	if (target === undefined) return request_of(undefined, '')

	return request_of(await issue_release_cli.find_open(target), target)
}

const release_request = { read, request_of, RELEASE_COMMAND, UNKNOWN }

export type { ReleaseRequestLines }
export { release_request }
