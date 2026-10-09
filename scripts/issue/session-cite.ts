import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { repo_origin } from '#scripts/discovery/repo-origin'
import { issue_citation } from '#scripts/rules/issue-citation'
import { issue_cite } from './issue-cite'

// How a josh command names an Issue in what it prints to the session.
//
// **A line a command prints is a line a session copies.** A run quotes a progress line, a warning or a
// refusal into its reply verbatim, and a bare `#N` in that line reaches the reply as a bare `#N` — which
// the Stop guard then sends back for a second turn spent re-citing it. Printing the citation form at the
// source makes the cheap path and the correct path the same one, the reasoning `issue:cite` itself was
// built on.
//
// **The repository is read from the work tree's own `origin`, not asked of `gh`.** Most printing sites
// hold no `owner/repo`, and a network read per printed line would put a round trip — and a way to fail
// — into every warning. The config is a local file (`repo_discovery.read_origin_url`), and it is the
// same remote `gh` expands `{owner}/{repo}` from, so the link points at the repository the command acts
// on. A work tree with no GitHub origin falls back to the plain `#N`, the same fallback `reference` has.
//
// **The title is used when the caller already holds it, and never fetched.** A link without a title
// still resolves to the Issue in one click and passes the Stop guard as cited; fetching a title per line
// would cost the `gh` call this module exists to avoid.
//
// **A line assembled elsewhere is linked where it is printed.** A summary, a report or a list built by
// a helper that also feeds GitHub or a parser holds `issue_cite.plain`; `text` links every bare `#N` in
// it at the print boundary, the same `issue_citation.linkify` pass the listings already print through.

// `owner/repo` of the repository the command runs in, or `undefined` without a GitHub `origin`.
function session_repo(): string | undefined {
	const url = repo_discovery.read_origin_url(process.cwd())
	const identity = url === undefined ? undefined : repo_origin.parse_origin_url(url)

	return identity === undefined ? undefined : `${identity.owner}/${identity.repo}`
}

// One Issue as a session reads it: `[#N](url) — title` with a title, `[#N](url)` without one. `repo`
// names another repository's Issue; it defaults to the one the command runs in.
function issue(number: number | string, title?: string, repo = session_repo()): string {
	return issue_cite.reference(repo, String(number), title)
}

// `message` as a session reads it: every bare `#N` linked to the repository the command runs in, left
// as it is without a GitHub `origin`.
function text(message: string): string {
	const repo = session_repo()

	return repo === undefined ? message : issue_citation.linkify(message, repo)
}

const session_cite = {
	issue,
	session_repo,
	text,
}

export { session_cite }
