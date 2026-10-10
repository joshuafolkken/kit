// The paste-ready citation line `josh issue:cite` prints, kept apart from the reading and the
// printing so the shape of the line is decided by one pure function.
//
// **It exists because the correct citation form has a cost the bare `#N` does not.** `CLAUDE.md` and
// `prompts/collaboration-workflow/issue-citation.md` require session-facing output to cite an Issue
// as `[#<N>](https://github.com/<owner>/<repo>/issues/<N>) — <summary>`, and assembling that by hand
// means reading each Issue's title first — a per-Issue round trip that lands exactly where several
// Issues are named at once (a backlog listing, a lane status report), which is where the bare `#N`
// falls out. This command makes the cheap path and the correct path the same one.
//
// **The summary is the Issue's own title, fetched, not a translation of it.** A script cannot
// translate deterministically, and an LLM call per Issue would defeat the point of a cheap citation
// helper and make the output untestable; the title already says what the Issue does, which is all the
// rule asks of the summary — knowing what it does is enough. The reader adapts it to the session
// language when it matters, without a round trip to learn the title at all.

const GITHUB_URL_PREFIX = 'https://github.com/'
const ISSUE_PATH = '/issues/'
const SUMMARY_SEPARATOR = ' — '

// `owner/repo#N`, so a citation can name another repository's Issue; the two segment classes exclude a
// slash and a `#` so the split between the repository and the number is unambiguous.
const REPO_QUALIFIED = /^([^\s/#]+\/[^\s/#]+)#(\d+)$/u
// A bare number, with the `#` optional: the source is usually a `#N` copied out of prose, and refusing
// the `#` would make the command reject exactly what it exists to correct.
const BARE_NUMBER = /^#?(\d+)$/u

// `repo` is `owner/repo`, or `undefined` for the repository the command runs in — the same contract
// the reads underneath take, so a bare number and a qualified one flow through one path.
interface CiteTarget {
	number: string
	repo: string | undefined
}

// The plain `#N`, or `owner/repo#N` when a repository is named — the one place the bare form is
// assembled. It is for text GitHub renders or a program reads: an Issue or PR
// body, a comment, a commit message, a pattern, a key. GitHub links that text itself, so it needs no
// link of its own; what a session reads goes through `session_cite.issue` instead, and the scan in
// `session-cite-scan.test.ts` refuses a bare `#${…}` assembled anywhere else.
function plain(number: number | string, repo = ''): string {
	return `${repo}#${String(number)}`
}

function issue_url(slug: string, number: string): string {
	return `${GITHUB_URL_PREFIX}${slug}${ISSUE_PATH}${number}`
}

function citation_line(slug: string, number: string, summary: string): string {
	return `[${plain(number)}](${issue_url(slug, number)})${SUMMARY_SEPARATOR}${summary}`
}

// How a listing names one issue, given what it already holds. A progress
// command's output is copied into a report verbatim, so the line it prints is the citation the report
// carries: the full form when the title is in hand, the bare number-link when only the repository is,
// and the plain `#N` only when the repository could not be read at all.
type IssueCiter = (number: string) => string

// One issue, named from what the caller holds — the single decision every listing's citation goes
// through, so a renderer holding one title never re-derives the fallback.
function reference(slug: string | undefined, number: string, title: string | undefined): string {
	if (slug === undefined) return plain(number)

	return title === undefined
		? `[${plain(number)}](${issue_url(slug, number)})`
		: citation_line(slug, number, title)
}

function citer(slug: string | undefined, titles: ReadonlyMap<string, string>): IssueCiter {
	return function cite(number: string): string {
		return reference(slug, number, titles.get(number))
	}
}

function qualified_target(token: string): CiteTarget | undefined {
	const match = REPO_QUALIFIED.exec(token)
	if (match === null) return undefined

	const [, repo = '', number = ''] = match

	return { number, repo }
}

function bare_target(token: string, default_repo: string | undefined): CiteTarget | undefined {
	const match = BARE_NUMBER.exec(token)
	if (match === null) return undefined

	const [, number = ''] = match

	return { number, repo: default_repo }
}

// `undefined` for a token that is neither a bare number nor an `owner/repo#N` — the caller refuses the
// whole invocation rather than dropping it, so a mistyped argument never silently loses its citation.
function parse_target(token: string, default_repo: string | undefined): CiteTarget | undefined {
	return qualified_target(token) ?? bare_target(token, default_repo)
}

// How a target is named in a failure line: `owner/repo#N` when it names another repository, `#N`
// otherwise — the form the reader typed, so the line points back at the argument it is about.
function label(target: CiteTarget): string {
	return plain(target.number, target.repo)
}

// A number that resolves to nothing, told apart from a read that failed: this one will not change on a
// retry, so it names the number and the repository rather than suggesting a wait.
function missing_line(target: CiteTarget): string {
	return `✖ ${label(target)}: issue does not resolve — check the number and the repository`
}

// A read that failed over something the number is not responsible for — a rate limit, expired auth, a
// dropped connection — so the same call a moment later may succeed.
function unreadable_line(target: CiteTarget): string {
	return `✖ ${label(target)}: could not be read — a rate limit, expired auth, or a dropped connection`
}

// The repository itself could not be read, so a bare number has no `owner/repo` to build a link from.
function no_repo_line(target: CiteTarget): string {
	return `✖ ${label(target)}: could not read this repository — check gh auth and the origin remote`
}

const issue_cite = {
	citation_line,
	citer,
	issue_url,
	missing_line,
	no_repo_line,
	parse_target,
	plain,
	reference,
	unreadable_line,
}

export type { CiteTarget, IssueCiter }
export { issue_cite }
