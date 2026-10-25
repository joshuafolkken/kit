// The body lines that sit under one `## heading`, up to the next `## heading` or the end.
// Both the firing-point check and the baseline parser read a section this
// way, so the slicing lives in one place rather than being written twice.

const HEADING_PREFIX = '## '
// A body saved from GitHub's web editor ends its lines with CRLF; a kept `\r` would end every line's
// text with it and defeat each `$`-anchored match downstream.
const LINE_BREAK_PATTERN = /\r?\n/u

function is_heading(line: string): boolean {
	return line.trimStart().startsWith(HEADING_PREFIX)
}

function is_the_heading(line: string, heading: string): boolean {
	return line.trim() === heading
}

// Whether some body line, trimmed, is exactly `text`. Both linters ask this — of a `## heading` and of
// the behavior-change declaration line — so the trim-and-match lives here rather than being written in
// each. A required token mentioned inside a sentence is not the token, so only an exact line matches.
function next_fence(line: string, fence: string): string | undefined {
	const marker = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1]

	if (fence === '') return marker
	const closing = new RegExp(
		String.raw`^ {0,3}${fence.charAt(0)}{${String(fence.length)},}\s*$`,
		'u',
	)

	if (closing.test(line)) return ''

	return undefined
}

function lines_of(body: string): ReadonlyArray<string> {
	return body.split(LINE_BREAK_PATTERN)
}

// The body's lines with every fenced line, fences included, blanked. Indentation is kept, so a list
// item's indented continuation survives.
function fence_free_lines(body: string): ReadonlyArray<string> {
	let fence = ''
	const visible: Array<string> = []

	for (const line of lines_of(body)) {
		const next = next_fence(line, fence)

		visible.push(next === undefined && fence === '' ? line : '')
		fence = next ?? fence
	}

	return visible
}

// As `fence_free_lines`, with an indented code line (4 spaces or a tab) blanked too.
function unfenced_lines(body: string): ReadonlyArray<string> {
	return fence_free_lines(body).map((line) => line.replace(/^(?: {4}|\t).*/u, ''))
}

function has_unfenced_line(body: string, text: string): boolean {
	return unfenced_lines(body).some((line) => line.trim() === text)
}

function has_line(body: string, text: string): boolean {
	return has_unfenced_line(body, text)
}

// The lines between the first unfenced line `is_target` accepts and the next unfenced `## ` heading,
// trimmed of the heading line itself; an empty array when no line is accepted. A `## ` line inside a
// code fence is example text, so it neither opens nor closes a section.
function section_lines_matching(
	body: string,
	is_target: (line: string) => boolean,
): ReadonlyArray<string> {
	const lines = lines_of(body)
	const visible = unfenced_lines(body)
	const start = visible.findIndex((line) => is_target(line))

	if (start === -1) return []

	const rest = lines.slice(start + 1)
	const end = visible.slice(start + 1).findIndex((line) => is_heading(line))

	return end === -1 ? rest : rest.slice(0, end)
}

// A heading matched inside a sentence is not the section heading, so only a line that is exactly the
// heading opens the section.
function section_lines(body: string, heading: string): ReadonlyArray<string> {
	return section_lines_matching(body, (line) => is_the_heading(line, heading))
}

const markdown_section = {
	section_lines,
	section_lines_matching,
	fence_free_lines,
	lines_of,
	unfenced_lines,
	has_line,
	has_unfenced_line,
}

export { markdown_section }
