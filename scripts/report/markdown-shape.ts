// The shape checks the fixed-shape linters share — `report:lint`, its `--child-summary` mode and
// `review:submit --review` — kept in one place so the fence rule and the line count read the same
// in all three.

const FENCE_MARKER = '```'

// The non-blank lines: what a line bound counts and what the first-line checks read.
function content_lines(text: string): ReadonlyArray<string> {
	return text.split('\n').filter((line) => line.trim().length > 0)
}

function first_content_line(text: string): string {
	return content_lines(text)[0]?.trim() ?? ''
}

function is_fenced(text: string): boolean {
	return first_content_line(text).startsWith(FENCE_MARKER)
}

// `subject` names the artifact in the message: `summary`, `review`.
function fence_violation(text: string, subject: string): ReadonlyArray<string> {
	return is_fenced(text)
		? [`✖ the ${subject} is wrapped in a code fence — write it as plain markdown`]
		: []
}

const markdown_shape = { content_lines, first_content_line, fence_violation }

export { markdown_shape }
