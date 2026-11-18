import { issue_body_keys, type IssueBodyKey } from './issue-body-keys'
import { markdown_section } from './markdown-section'

const BACKGROUND_HEADING = issue_body_keys.heading('background')
const BULLET = '- '
const NEWLINE = '\n'

// Every declaration line of `keys`, in either language, so a rewrite never leaves the filer's own
// behind (joshuafolkken/kit#7210).
function declaration_lines(keys: ReadonlyArray<IssueBodyKey>): RegExp {
	const prefixes = keys.flatMap((key) => issue_body_keys.prefix_variants(key))

	return new RegExp(String.raw`^(?:${prefixes.join('|')})(?:[ \t].*)?(?:\n|$)`, 'gmu')
}

// Where a declaration goes in the background section: after its first run of `- ` lines, else first.
function block_end(lines: ReadonlyArray<string>): number {
	const first = lines.findIndex((line) => line.startsWith(BULLET))

	if (first === -1) return 0
	const run = lines.slice(first).findIndex((line) => !line.startsWith(BULLET))

	return run === -1 ? lines.length : first + run
}

function append_lines(before: string, lines: ReadonlyArray<string>): string {
	const separator = before === '' || before.endsWith(NEWLINE) ? '' : NEWLINE

	const added = lines.map((line) => line + NEWLINE).join('')

	return `${before}${separator}${added}`
}

function insert_lines(section: string, added: ReadonlyArray<string>): string {
	const lines = section.split(/(?<=\n)/u)
	const at = block_end(lines)

	return `${append_lines(lines.slice(0, at).join(''), added)}${lines.slice(at).join('')}`
}

// The body with every line `drop` matches removed and `lines` closing the background section's
// declaration block, or the body when it has no such section. The body is newline-terminated first,
// so a heading on its last line keeps the lines off its own.
function with_declaration_lines(body: string, drop: RegExp, lines: ReadonlyArray<string>): string {
	const stripped = body.replaceAll(drop, '')

	if (!markdown_section.has_line(stripped, BACKGROUND_HEADING)) return append_lines(stripped, lines)

	return markdown_section.map_section(
		stripped.endsWith(NEWLINE) ? stripped : `${stripped}${NEWLINE}`,
		(line) => line.trim() === BACKGROUND_HEADING,
		(section) => insert_lines(section, lines),
	)
}

// The lines `drop` matches in `body`, trimmed, in order — what `with_declaration_lines` would remove.
function declared(body: string, drop: RegExp): ReadonlyArray<string> {
	return [...body.matchAll(drop)].map((match) => match[0].trim())
}

const issue_declaration_line = { declaration_lines, declared, with_declaration_lines }

export { issue_declaration_line }
