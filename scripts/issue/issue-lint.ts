// The Issue body template's four headings (`prompts/collaboration-workflow/issue-template.md`) are a
// fixed shape, but unlike an epic — which `josh epic:check` verifies — nothing checks that a filed
// Issue carries them. This reports the ones a body is missing (joshuafolkken/kit#2123). The headings
// are the single source's, and the document test pins that these match it.
const REQUIRED_HEADINGS: ReadonlyArray<string> = [
	'## 背景',
	'## 現象',
	'## 期待結果',
	'## 受け入れ条件',
]

function heading_lines(body: string): ReadonlyArray<string> {
	return body.split('\n').map((line) => line.trim())
}

// A heading is present when a line is exactly it — a `## 背景` mentioned inside a sentence is not the
// section heading, and matching a substring would accept it.
function has_heading(body: string, heading: string): boolean {
	return heading_lines(body).includes(heading)
}

// The required headings a body lacks, in template order; an empty array is a conforming body.
function missing_headings(body: string): ReadonlyArray<string> {
	return REQUIRED_HEADINGS.filter((heading) => !has_heading(body, heading))
}

const issue_lint = {
	missing_headings,
	REQUIRED_HEADINGS,
}

export { issue_lint }
