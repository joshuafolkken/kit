import { issue_body_keys } from './issue-body-keys'
import { markdown_section } from './markdown-section'

// The Issue body template's four headings (`prompts/collaboration-workflow/issue-template.md`) are a
// fixed shape, but unlike an epic — which `josh epic:check` verifies — nothing checks that a filed
// Issue carries them. This reports the ones a body is missing. The headings
// are the single source's, and the document test pins that these match it.
const REQUIRED_HEADINGS: ReadonlyArray<string> = (
	['background', 'symptom', 'expected', 'criteria'] as const
).map((name) => issue_body_keys.heading(name))

// The required headings a body lacks, in template order; an empty array is a conforming body. A heading
// is present when a line is exactly it (`markdown_section.has_line`) — one mentioned inside a sentence
// is not the section heading.
function missing_headings(body: string): ReadonlyArray<string> {
	return REQUIRED_HEADINGS.filter((heading) => !markdown_section.has_line(body, heading))
}

// The plain-language summary a person reads before any internal detail (joshuafolkken/kit#7544).
const SUMMARY_HEADING = issue_body_keys.heading('summary')

// Whether the body's first non-blank line is the summary heading — present further down does not count.
function starts_with_summary(body: string): boolean {
	const first = markdown_section.lines_of(body).find((line) => line.trim() !== '')

	return first?.trim() === SUMMARY_HEADING
}

const issue_lint = {
	missing_headings,
	REQUIRED_HEADINGS,
	starts_with_summary,
	SUMMARY_HEADING,
}

export { issue_lint }
