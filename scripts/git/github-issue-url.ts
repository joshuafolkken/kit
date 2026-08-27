// Reading a GitHub issue URL as an issue's identity: which repository it is in, and which number.
// `josh notify` resolves the repository a notification is *about* this way, because the working
// directory answers a different question — which repository the session happens to be running in.
// A notification filed about another repository used to carry that repository's URL under this
// repository's name (joshuafolkken/kit#903).
//
// Two other modules read a URL for something narrower and keep their own patterns. `git-epic-parse`
// scans an epic body for task-list rows, so its regex is anchored to the row marker and runs
// globally over a document; `propagate-steps` takes the trailing number of whatever URL
// `gh issue create` just printed, where the repository is already known. This one is for a caller
// holding a single URL and needing the repository it names.
const NAME_WITH_OWNER_SEPARATOR = '/'
// `\b` after the number, so `.../issues/431x` is refused rather than read as issue 431 — the
// caller's fallback is the working directory, which is a visibly wrong answer rather than a
// plausible one. A trailing `#anchor` or `?query` still parses, since neither is a word character.
const ISSUE_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)\b/u

interface IssueUrlTarget {
	owner: string
	repo: string
	// `owner/repo`, the form `gh --repo` takes — kept beside the parts so no caller re-joins them.
	name_with_owner: string
	issue_number: string
}

// `undefined` for anything that is not a github.com issue URL, including an absent one: every
// caller's fallback is the same either way, so a thrown error would only move the branch.
//
// The destructuring defaults in `build_target` are unreachable — a match fills all three groups —
// and exist because `noUncheckedIndexedAccess` types them as optional.
function build_target(match: RegExpExecArray): IssueUrlTarget {
	const [, owner = '', repo = '', issue_number = ''] = match

	return {
		owner,
		repo,
		name_with_owner: `${owner}${NAME_WITH_OWNER_SEPARATOR}${repo}`,
		issue_number,
	}
}

function parse(issue_url: string | undefined): IssueUrlTarget | undefined {
	const match = ISSUE_URL_PATTERN.exec(issue_url ?? '')
	if (match === null) return undefined

	return build_target(match)
}

const github_issue_url = { parse }

export { github_issue_url }
export type { IssueUrlTarget }
