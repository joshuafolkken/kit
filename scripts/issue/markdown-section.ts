// The body lines that sit under one `## heading`, up to the next `## heading` or the end
// (joshuafolkken/kit#2212). Both the firing-point check and the baseline parser read a section this
// way, so the slicing lives in one place rather than being written twice.

const HEADING_PREFIX = '## '

function is_heading(line: string): boolean {
	return line.trimStart().startsWith(HEADING_PREFIX)
}

function is_the_heading(line: string, heading: string): boolean {
	return line.trim() === heading
}

// Whether some body line, trimmed, is exactly `text`. Both linters ask this — of a `## heading` and of
// the behavior-change declaration line — so the trim-and-match lives here rather than being written in
// each. A required token mentioned inside a sentence is not the token, so only an exact line matches.
function has_line(body: string, text: string): boolean {
	return body.split('\n').some((line) => line.trim() === text)
}

// The lines between `heading` and the next `## ` heading, trimmed of the heading line itself; an empty
// array when the heading is absent. A heading matched inside a sentence is not the section heading, so
// only a line that is exactly the heading opens the section.
function section_lines(body: string, heading: string): ReadonlyArray<string> {
	const lines = body.split('\n')
	const start = lines.findIndex((line) => is_the_heading(line, heading))

	if (start === -1) return []

	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => is_heading(line))

	return end === -1 ? rest : rest.slice(0, end)
}

const markdown_section = { section_lines, is_heading, has_line }

export { markdown_section }
