// The issue numbers on `run:board` open their GitHub issue: each is wrapped in
// an OSC 8 terminal hyperlink, so VSCode's terminal opens it on Cmd+click while the visible text stays
// the number. A reference is drawn the way the plan names it — `3450` for this repository's issue,
// `owner/repo#12` for one elsewhere — and links to the repository it names. A followup row's pull
// request number opens its pull request the same way (joshuafolkken/kit#4625).
//
// The columns are padded on the text before it is linked: the escape draws nothing, but `padEnd`
// counts it. Whether a terminal gets the escape at all is the `link` port's answer.

const GITHUB_URL_PREFIX = 'https://github.com/'
const QUALIFIED = /^(?<repo>[^#]+)#(?<number>\d+)$/u

type Link = (text: string, url: string) => string

// `owner/repo#12` names its own repository; a bare number names `repo`'s.
function issue_url(reference: string, repo: string): string {
	const { repo: target = repo, number = reference } = QUALIFIED.exec(reference)?.groups ?? {}

	return `${GITHUB_URL_PREFIX}${target}/issues/${number}`
}

// A pull request of `repo` (joshuafolkken/kit#4625).
function pull_url(number: number, repo: string): string {
	return `${GITHUB_URL_PREFIX}${repo}/pull/${String(number)}`
}

// A board with no plan read yet knows no repository, so its references stay plain text.
function linker(repo: string | undefined, link: Link): (reference: string) => string {
	if (repo === undefined) return (reference) => reference

	return (reference) => link(reference, issue_url(reference, repo))
}

// A pull request's number linked to it, plain text on the same rule as `linker`.
function pull_linker(repo: string | undefined, link: Link): (number: number) => string {
	if (repo === undefined) return String

	return (number) => link(String(number), pull_url(number, repo))
}

// The page of the repository itself a header part opens: its top, or its open or closed issues
// (joshuafolkken/kit#7089).
type RepoPage = 'home' | 'open' | 'closed'

type RepoLink = (text: string, page: RepoPage) => string

// The links a board draws, each plain before a plan names the repository.
interface BoardLinks {
	// An issue reference as the board draws it — `3450` or `owner/repo#12`.
	link: (reference: string) => string
	// A pull request's number (joshuafolkken/kit#4625).
	pull_link: (number: number) => string
	// A header part — the repository's name, an issue count — to a page of the repository.
	repo_link: RepoLink
}

// The repository's top, or its open or closed issues as GitHub's own search spells them.
function repo_url(repo: string, page: RepoPage): string {
	if (page === 'home') return `${GITHUB_URL_PREFIX}${repo}`

	const query = new URLSearchParams({ q: `is:issue is:${page}` })

	return `${GITHUB_URL_PREFIX}${repo}/issues?${query.toString()}`
}

// A header part linked to a page of the repository, plain text on the same rule as `linker`.
function repo_linker(repo: string | undefined, link: Link): RepoLink {
	if (repo === undefined) return (text) => text

	return (text, page) => link(text, repo_url(repo, page))
}

function links_of(repo: string | undefined, link: Link): BoardLinks {
	return {
		link: linker(repo, link),
		pull_link: pull_linker(repo, link),
		repo_link: repo_linker(repo, link),
	}
}

const run_board_link = { issue_url, linker, links_of, pull_linker, pull_url, repo_linker, repo_url }

export { run_board_link }
export type { BoardLinks, Link, RepoLink, RepoPage }
