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

const run_board_link = { issue_url, linker, pull_linker, pull_url }

export { run_board_link }
export type { Link }
