// Reading one **section** of a markdown document, because a section is the unit these documents
// cross-reference each other in (joshuafolkken/kit#1776).
//
// **The reference form was already a section reference, and only the reader was missing.** Every
// workflow document points at another one as `` `epicrun.md` → "The hand-off" `` — a file *and* a
// heading. A reader with no way to fetch a heading has one move left, which is to open the file, so
// a pointer at 249 lines was costing 2,121. Measured at the `queue` entry point, `epicrun.md` is
// opened for four such references and is the single largest item in everything the entry reads.
//
// **Nothing here defers a read.** The section is fetched in the same turn, in the main line, by the
// run that has to obey it — what changes is the extent of the fetch, never whether it happens. That
// is the distinction joshuafolkken/kit#1344 and joshuafolkken/kit#1460 were written after: a rule
// moved to "read it later" is a rule that measurably never fires, and this moves nothing to later.

import { readFileSync } from 'node:fs'

// `#` to `######`, one space, then the title. Written with a literal space rather than `\s+` and a
// lazy title so it cannot backtrack: `sonarjs/super-linear-regex` rejects the `\s+…+?\s*$` shape,
// and the trim below does the same job in linear time.
const HEADING_PATTERN = /^(?<hashes>#{1,6}) (?<title>.*)$/u
const FENCE = '```'
const SINGLE_MATCH = 1

interface Heading {
	level: number
	title: string
	// Zero-based index into the document's lines, so a slice needs no arithmetic.
	line: number
}

interface Section {
	title: string
	level: number
	first_line: number
	last_line: number
	text: string
}

function to_heading(line: string, index: number): Heading | undefined {
	const groups = HEADING_PATTERN.exec(line)?.groups

	if (groups === undefined) return undefined

	// Destructured rather than read as properties: `noPropertyAccessFromIndexSignature` refuses
	// `groups.title`. The bracket form was refused too, until joshuafolkken/kit#1783 switched off the
	// `dot-notation` fix that rewrote it back — so this is a choice now rather than the only spelling.
	const { hashes = '', title = '' } = groups

	return { level: hashes.length, title: title.trim(), line: index }
}

function push_heading(found: Array<Heading>, line: string, index: number): void {
	const heading = to_heading(line, index)

	if (heading !== undefined) found.push(heading)
}

// **Fenced blocks are skipped, and that is not defensive tidying.** These documents quote shell, and
// a shell comment at the start of a line is a `#` in column one. Counted as a heading it would end
// the section above it early, which is a silent wrong answer rather than a visible failure.
function headings(markdown: string): Array<Heading> {
	const found: Array<Heading> = []
	let is_inside_fence = false

	for (const [index, line] of markdown.split('\n').entries()) {
		if (line.startsWith(FENCE)) is_inside_fence = !is_inside_fence
		else if (!is_inside_fence) push_heading(found, line, index)
	}

	return found
}

function titles(markdown: string): Array<string> {
	return headings(markdown).map((heading) => heading.title)
}

// **Prefix, because a reference cites the name and the heading carries the name plus its gloss.**
// `` → "The hand-off" `` points at `## The hand-off — one session does not have to run the whole
// epic`, and `` → "The check is asked at every merge" `` at a heading that continues with a comma.
// Requiring the whole heading would make every such reference unresolvable, and citing the whole
// heading in the prose would put the gloss into every pointer.
function is_match(heading: Heading, wanted: string): boolean {
	return heading.title.startsWith(wanted)
}

function prefixed(found: ReadonlyArray<Heading>, wanted: string): Array<Heading> {
	return found.filter((heading) => is_match(heading, wanted))
}

// **Exact wins, and an ambiguous prefix is refused rather than ranked.** Two headings that both
// start with the cited text is a document whose reference is genuinely ambiguous; picking the first
// would hand back a section nobody named, which is a failure a whole-file read does not have.
function select(found: ReadonlyArray<Heading>, wanted: string): Heading | undefined {
	const exact = found.find((heading) => heading.title === wanted)

	if (exact !== undefined) return exact

	const near = prefixed(found, wanted)

	return near.length === SINGLE_MATCH ? near[0] : undefined
}

// A section ends where the next heading of the same or higher rank begins, so a `##` section carries
// its `###` subsections with it — which is what a pointer at a `##` heading means.
function last_line_of(found: ReadonlyArray<Heading>, chosen: Heading, total_lines: number): number {
	const index = found.indexOf(chosen)
	const next = found.slice(index + SINGLE_MATCH).find((heading) => heading.level <= chosen.level)

	return (next === undefined ? total_lines : next.line) - SINGLE_MATCH
}

function section(markdown: string, wanted: string): Section | undefined {
	const lines = markdown.split('\n')
	const found = headings(markdown)
	const chosen = select(found, wanted)

	if (chosen === undefined) return undefined

	const last_line = last_line_of(found, chosen, lines.length)

	return {
		title: chosen.title,
		level: chosen.level,
		first_line: chosen.line,
		last_line,
		text: lines.slice(chosen.line, last_line + SINGLE_MATCH).join('\n'),
	}
}

// Ambiguity and absence are different answers, and the caller reports them differently: one names
// the candidates, the other lists every heading the file has.
function candidates(markdown: string, wanted: string): Array<string> {
	return prefixed(headings(markdown), wanted).map((heading) => heading.title)
}

function read_optional(file_path: string): string | undefined {
	try {
		return readFileSync(file_path, 'utf8')
	} catch {
		return undefined
	}
}

const document_section = {
	FENCE,
	HEADING_PATTERN,
	candidates,
	headings,
	read_optional,
	section,
	select,
	titles,
}

export type { Heading, Section }
export { document_section }
