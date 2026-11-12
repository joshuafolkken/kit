// GitHub refuses a release whose body exceeds this many characters (HTTP 422).
const MAX_BODY_LENGTH = 125_000
const LINE_BREAK = '\n'

function changelog_url(repository: string, tag: string, previous: string | undefined): string {
	const root = `https://github.com/${repository}`

	return previous === undefined ? `${root}/commits/${tag}` : `${root}/compare/${previous}...${tag}`
}

// Cut at a line break so no Markdown line or surrogate pair is split; the changelog link stays last.
function cap_body(body: string, url: string): string {
	if (body.length <= MAX_BODY_LENGTH) return body

	const tail = `${LINE_BREAK}${LINE_BREAK}…${LINE_BREAK}${LINE_BREAK}**Full Changelog**: ${url}`
	const head = body.slice(0, MAX_BODY_LENGTH - tail.length)
	const line_end = head.lastIndexOf(LINE_BREAK)

	return `${line_end > 0 ? head.slice(0, line_end) : head}${tail}`
}

const github_release_notes = { MAX_BODY_LENGTH, cap_body, changelog_url }

export { github_release_notes }
