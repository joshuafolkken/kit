import { git_epic_parse } from './git-epic-parse'

// Locating a `## <Name>` section inside an epic body, as the shape every rewrite of one needs.
//
// It was `git-epic-add-body.ts`'s private half: that file finds the `Dependencies` section so a
// declaration is replaced inside it rather than wherever a declaration-shaped line happens to sit.
// `## Decisions` needs the identical search, and a second copy of it is the clone `CLAUDE.md`
// prohibits — the fence mask especially, since a heading inside a fenced block is an illustration and
// a copy that forgot it would append a decision into a quoted template (joshuafolkken/kit#1350).
//
// Nothing here writes. The two consumers decide what to do with a range; this decides where one is.

// A heading of any level, with its `#` run captured so the level can be compared. Read from the
// trimmed line, so an indented heading inside a list still counts as one.
const ANY_HEADING = /^(#{1,6})[ \t]/u
const HEADING_LEVEL_GROUP = 1
const NOT_A_HEADING = 0

interface BodyLines {
	lines: ReadonlyArray<string>
	// `false` for a fence line and everything between a pair of them. A heading or a declaration
	// inside a fenced block is an illustration, and treating one as real would edit a quoted template.
	mask: ReadonlyArray<boolean>
}

interface SectionRange {
	// The first line after the heading, and the first line of whatever follows the section.
	start: number
	end: number
}

// Accepts the body or the lines it was already split into: `git-epic-add-body.ts` holds both forms at
// different points of one rewrite, and `join`/`split` round-trip exactly, so one function serves both
// rather than the caller re-deriving a mask that has to agree with this one.
function to_body_lines(source: string | ReadonlyArray<string>): BodyLines {
	const lines = typeof source === 'string' ? source.split('\n') : source

	return { lines, mask: git_epic_parse.fence_mask(lines.join('\n')) }
}

function is_readable(input: BodyLines, index: number): boolean {
	return input.mask[index] === true
}

function find_indices(input: BodyLines, is_wanted: (line: string) => boolean): Array<number> {
	return input.lines
		.map((line, index) => (is_readable(input, index) && is_wanted(line) ? index : -1))
		.filter((index) => index !== -1)
}

// A line's heading level, or `0` for a line that is not a heading.
function heading_level(line: string): number {
	return (ANY_HEADING.exec(line.trim())?.[HEADING_LEVEL_GROUP] ?? '').length
}

// Whether this line closes a section opened at `level`: a readable heading of the same level or a
// higher one. A deeper heading belongs to the section rather than ending it.
function is_section_end(input: BodyLines, index: number, level: number): boolean {
	if (!is_readable(input, index)) return false
	const found = heading_level(input.lines[index] ?? '')

	return found !== NOT_A_HEADING && found <= level
}

// Where the named section runs: the lines after its heading, up to the next heading **of the same or a
// higher level**. Not "the next heading of any level" — `## Decisions` is written as one `###` entry per
// decision, the template `epic:plan` documents, so ending at any heading would make the section one
// line long and place every appended record after its first entry (joshuafolkken/kit#1350). A `##`
// section running to the next `##` is what a reader of the body already takes it to mean.
//
// `undefined` is "the body has no such section", which is a different answer from an empty one — the
// caller creates the section in the first case and appends inside it in the second.
function find_section_range(input: BodyLines, heading: RegExp): SectionRange | undefined {
	const [found] = find_indices(input, (line) => heading.test(line.trim()))
	if (found === undefined) return undefined

	const level = heading_level(input.lines[found] ?? '')
	const start = found + 1
	const next = input.lines
		.slice(start)
		.findIndex((_line, offset) => is_section_end(input, start + offset, level))

	return { start, end: next === -1 ? input.lines.length : start + next }
}

function is_in_range(index: number, range: SectionRange): boolean {
	return index >= range.start && index < range.end
}

const git_epic_sections = {
	to_body_lines,
	find_indices,
	find_section_range,
	is_in_range,
}

export { git_epic_sections }
export type { BodyLines, SectionRange }
