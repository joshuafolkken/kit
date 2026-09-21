import { markdown_section } from './markdown-section'

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

// The required headings a body lacks, in template order; an empty array is a conforming body. A heading
// is present when a line is exactly it (`markdown_section.has_line`) — one mentioned inside a sentence
// is not the section heading.
function missing_headings(body: string): ReadonlyArray<string> {
	return REQUIRED_HEADINGS.filter((heading) => !markdown_section.has_line(body, heading))
}

const issue_lint = {
	missing_headings,
	REQUIRED_HEADINGS,
}

export { issue_lint }
