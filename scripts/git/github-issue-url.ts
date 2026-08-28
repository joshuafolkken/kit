// Reading a GitHub issue or pull-request URL as an identity: which repository it is in, and which
// number. `josh notify` resolves the repository a notification is *about* this way, because the
// working directory answers a different question — which repository the session happens to be
// running in. A notification filed about another repository used to carry that repository's URL
// under this repository's name (joshuafolkken/kit#903), and the same mismatch survived for a
// notification carrying only a pull-request URL until joshuafolkken/kit#994 added the second form
// here rather than beside it.
//
// Two other modules read a URL for something narrower and keep their own patterns. `git-epic-parse`
// scans an epic body for task-list rows, so its regex is anchored to the row marker and runs
// globally over a document; `propagate-steps` takes the trailing number of whatever URL
// `gh issue create` just printed, where the repository is already known. This one is for a caller
// holding a single URL and needing the repository it names.
const NAME_WITH_OWNER_SEPARATOR = '/'
const GITHUB_URL_PREFIX = 'https://github.com/'
// The prefix as regex source, so the host is written once and the two patterns below cannot drift
// apart from it or from each other. Only the dots need escaping in a URL of this shape.
const GITHUB_URL_PREFIX_SOURCE = GITHUB_URL_PREFIX.replaceAll('.', String.raw`\.`)
const REPOSITORY_SOURCE = `^${GITHUB_URL_PREFIX_SOURCE}([^/]+)/([^/]+)`
// `\b` after the number, so `.../issues/431x` is refused rather than read as issue 431 — the
// caller's fallback is the working directory, which is a visibly wrong answer rather than a
// plausible one. A trailing `#anchor` or `?query` still parses, since neither is a word character.
const ISSUE_URL_PATTERN = new RegExp(String.raw`${REPOSITORY_SOURCE}/issues/(\d+)\b`, 'u')
// The same shape for a pull request. `git-pr-followup` used to carry its own copy of this, anchored
// to the end of the string; reading `.../pull/12/files` now yields the repository it names instead
// of nothing, which is the better answer for every caller (joshuafolkken/kit#994).
const PULL_URL_PATTERN = new RegExp(String.raw`${REPOSITORY_SOURCE}/pull/(\d+)\b`, 'u')

// What both forms answer: which repository the URL names.
interface RepoIdentity {
	owner: string
	repo: string
	// `owner/repo`, the form `gh --repo` takes — kept beside the parts so no caller re-joins them.
	name_with_owner: string
	// `https://github.com/owner/repo`, so a caller building a sibling URL does not rebuild the host.
	base_url: string
}

// The two forms carry their number under different names on purpose. A pull target is then not
// assignable where an issue target is expected, so handing a PR number to a reader that runs
// `gh issue view` is a compile error rather than a notification carrying an unrelated issue's title
// — the joshuafolkken/kit#903 mismatch class, which this module exists to close.
interface IssueUrlTarget extends RepoIdentity {
	issue_number: string
}

interface PullUrlTarget extends RepoIdentity {
	pull_number: string
}

// `undefined` for anything that is not a github.com issue URL, including an absent one: every
// caller's fallback is the same either way, so a thrown error would only move the branch.
//
// The destructuring defaults in `build_target` are unreachable — a match fills all three groups —
// and exist because `noUncheckedIndexedAccess` types them as optional.
interface ParsedUrl {
	target: RepoIdentity
	number: string
}

function build_target(match: RegExpExecArray): ParsedUrl {
	const [, owner = '', repo = '', number = ''] = match

	const name_with_owner = `${owner}${NAME_WITH_OWNER_SEPARATOR}${repo}`

	return {
		target: {
			owner,
			repo,
			name_with_owner,
			base_url: `${GITHUB_URL_PREFIX}${name_with_owner}`,
		},
		number,
	}
}

function parse_with(pattern: RegExp, url: string | undefined): ParsedUrl | undefined {
	const match = pattern.exec(url ?? '')
	if (match === null) return undefined

	return build_target(match)
}

function parse(issue_url: string | undefined): IssueUrlTarget | undefined {
	const parsed = parse_with(ISSUE_URL_PATTERN, issue_url)
	if (parsed === undefined) return undefined

	return { ...parsed.target, issue_number: parsed.number }
}

// A pull-request URL names the same repository an issue URL does. `josh notify` reads it when it was
// given no `--issue-url`, so a completion notification carrying only a PR link stops being filed
// under the working directory's repository (joshuafolkken/kit#994).
function parse_pull(pull_url: string | undefined): PullUrlTarget | undefined {
	const parsed = parse_with(PULL_URL_PATTERN, pull_url)
	if (parsed === undefined) return undefined

	return { ...parsed.target, pull_number: parsed.number }
}

const github_issue_url = { parse, parse_pull }

export { github_issue_url }
export type { IssueUrlTarget, PullUrlTarget, RepoIdentity }
