// Reading one **section** of a markdown document, because a section is the unit these documents
// cross-reference each other in.
//
// **The reference form is a section reference.** Every workflow document points at another one as
// `` `backlogrun-progress.md` → "The hand-off" `` — a file *and* a heading. A reader with no way to
// fetch a heading has one move left, which is to open the whole file.
//
// **Nothing here defers a read.** The section is fetched in the same turn, in the main line, by the
// run that has to obey it — what changes is the extent of the fetch, never whether it happens. A rule
// moved to "read it later" is a rule that never fires, and this moves nothing to later.

import { file_reader } from '#scripts/lib/read-file'
import { document_scan } from './document-scan'

// `#` to `######`, one space, then the title. Written with a literal space rather than `\s+` and a
// lazy title so it cannot backtrack: `sonarjs/super-linear-regex` rejects the `\s+…+?\s*$` shape,
// and the trim below does the same job in linear time.
const HEADING_PATTERN = /^(?<hashes>#{1,6}) (?<title>.*)$/u
const FENCE = '```'
const SINGLE_MATCH = 1

// Any bold span is a citable anchor: the documents point at `- **Cross-package problems → …**` at a
// line start and at a `**…**` emphasis mid-paragraph alike.
const BOLD_LABEL_PATTERN = /\*\*([^*]+?)\*\*/gu
const BOLD_DELIMITER = '**'
// A one-line inline code span: a double-backtick span (which may quote a backtick) or a single one.
const CODE_SPAN_PATTERN = /``[^\n]*?``|`[^`\n]*`/gu
// A label ranks below every heading, so a heading section never ends at one.
const LABEL_LEVEL = 7
// A list item opens with `-`, `*` or a number, after any indentation.
const LIST_ITEM_PATTERN = /^(?<indent>\s*)(?:[-*]|\d+\.) /u

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
	// `groups.title`.
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
// One flag per line — `true` for a fence delimiter and every line between a pair of them — so the
// heading scan and the label scan cannot disagree on what is quoted code.
function fenced_flags(lines: ReadonlyArray<string>): Array<boolean> {
	let is_inside_fence = false

	return lines.map(function is_fenced(line: string): boolean {
		if (!line.startsWith(FENCE)) return is_inside_fence

		is_inside_fence = !is_inside_fence

		return true
	})
}

function headings(markdown: string): Array<Heading> {
	const lines = markdown.split('\n')
	const fenced = fenced_flags(lines)
	const found: Array<Heading> = []

	for (const [index, line] of lines.entries()) {
		if (fenced[index] !== true) push_heading(found, line, index)
	}

	return found
}

function titles(markdown: string): Array<string> {
	return headings(markdown).map((heading) => heading.title)
}

// The zero-based line each character offset sits on, read as the number of line starts at or before it.
function line_starts(markdown: string): Array<number> {
	return [...markdown.matchAll(/\n/gu)].map((match) => match.index + SINGLE_MATCH)
}

function line_of(starts: ReadonlyArray<number>, offset: number): number {
	return starts.filter((start) => start <= offset).length
}

// **A bold label is an anchor too**. The documents cite
// `- **Output language follows …**` exactly as they cite a heading, and the reference tests accepted
// both while this reader found only headings — so a green suite promised a section the command then
// refused. A label may wrap across lines, so the scan runs over the whole text, not line by line.
//
// Fenced lines are blanked before the scan rather than filtered after it: a `docs/**` glob in a
// fence would otherwise take a delimiter and pair every later `**` with the wrong partner. Blanking
// keeps the line count, so a label's line number still indexes the original document.
function unfenced_text(markdown: string): string {
	const lines = markdown.split('\n')
	const fenced = fenced_flags(lines)

	return lines.map((line, index) => (fenced[index] === true ? '' : line)).join('\n')
}

// An inline code span gets the same treatment one level down: `prompts/**` mid-paragraph would take a
// delimiter just as a fenced glob does. Its `*` become spaces, so every offset still indexes the
// unmasked text — which is where the title is read from, keeping a label that quotes code intact.
function code_masked(text: string): string {
	return text.replaceAll(CODE_SPAN_PATTERN, (span) => span.replaceAll('*', ' '))
}

function labels(markdown: string): Array<Heading> {
	const text = unfenced_text(markdown)
	const starts = line_starts(text)

	return [...code_masked(text).matchAll(BOLD_LABEL_PATTERN)].map((match) => ({
		level: LABEL_LEVEL,
		title: text.slice(
			match.index + BOLD_DELIMITER.length,
			match.index + match[0].length - BOLD_DELIMITER.length,
		),
		line: line_of(starts, match.index),
	}))
}

// **Prefix, because a reference cites the name and the heading carries the name plus its gloss.**
// `` → "The hand-off" `` points at `## The hand-off — one session does not have to run the whole
// epic`, and `` → "The check is asked at every merge" `` at a heading that continues with a comma.
// Requiring the whole heading would make every such reference unresolvable, and citing the whole
// heading in the prose would put the gloss into every pointer. Both sides are compared in the forms
// `document_scan.reference_forms` gives, so a reference that wraps or drops a heading's number lands.
function is_match(heading: Heading, wanted: string): boolean {
	return document_scan.reference_forms(heading.title).some((form) => form.startsWith(wanted))
}

function prefixed(found: ReadonlyArray<Heading>, wanted: string): Array<Heading> {
	const normalized = document_scan.normalize_reference(wanted)

	return found.filter((heading) => is_match(heading, normalized))
}

function is_exact(heading: Heading, wanted: string): boolean {
	return document_scan.reference_forms(heading.title).includes(wanted)
}

// **Exact wins, and an ambiguous prefix is refused rather than ranked.** Two headings that both
// start with the cited text is a document whose reference is genuinely ambiguous; picking the first
// would hand back a section nobody named, which is a failure a whole-file read does not have.
function select(found: ReadonlyArray<Heading>, wanted: string): Heading | undefined {
	const normalized = document_scan.normalize_reference(wanted)
	const exact = found.find((heading) => is_exact(heading, normalized))

	if (exact !== undefined) return exact

	const near = prefixed(found, wanted)

	return near.length === SINGLE_MATCH ? near[0] : undefined
}

// A section ends where the next heading of the same or higher rank begins, so a `##` section carries
// its `###` subsections with it — which is what a pointer at a `##` heading means.
function last_line_of(found: ReadonlyArray<Heading>, chosen: Heading, total_lines: number): number {
	const next = found.find((heading) => heading.line > chosen.line && heading.level <= chosen.level)

	return (next === undefined ? total_lines : next.line) - SINGLE_MATCH
}

function indent_of(line: string): number {
	return line.length - line.trimStart().length
}

// Where the block a label sits in stops: a blank line, a heading, or a list item at the label line's
// own depth or shallower — so a label's nested sub-items come with it and its next sibling does not.
function is_sibling_item(line: string, depth: number): boolean {
	const { indent } = LIST_ITEM_PATTERN.exec(line)?.groups ?? {}

	return indent !== undefined && indent.length <= depth
}

function ends_block(line: string, depth: number): boolean {
	if (line.trim() === '' || HEADING_PATTERN.test(line)) return true

	return is_sibling_item(line, depth)
}

// A label's section is the paragraph or list item it opens, not the rest of the document.
function label_last_line(lines: ReadonlyArray<string>, label: Heading): number {
	const depth = indent_of(lines[label.line] ?? '')
	const end = lines.findIndex((line, index) => index > label.line && ends_block(line, depth))

	return (end === -1 ? lines.length : end) - SINGLE_MATCH
}

// **A heading answers before any label does.** A label is consulted only when no heading even
// starts with the cited text, so an ambiguous heading reference is refused rather than rescued by a
// bold span that happens to share its prefix.
function choose(markdown: string, wanted: string): Heading | undefined {
	const found = headings(markdown)

	if (prefixed(found, wanted).length > 0) return select(found, wanted)

	return select(labels(markdown), wanted)
}

function extent_of(markdown: string, chosen: Heading): number {
	const lines = markdown.split('\n')

	if (chosen.level === LABEL_LEVEL) return label_last_line(lines, chosen)

	return last_line_of(headings(markdown), chosen, lines.length)
}

function section(markdown: string, wanted: string): Section | undefined {
	const chosen = choose(markdown, wanted)

	if (chosen === undefined) return undefined

	const last_line = extent_of(markdown, chosen)
	const lines = markdown.split('\n').slice(chosen.line, last_line + SINGLE_MATCH)

	return {
		title: chosen.title,
		level: chosen.level,
		first_line: chosen.line,
		last_line,
		text: lines.join('\n'),
	}
}

// Ambiguity and absence are different answers, and the caller reports them differently: one names
// the candidates, the other lists every heading the file has.
// Candidates follow `choose`'s order — headings, and labels only when no heading matches — so a
// refusal never suggests a label that citing it could not select.
function candidates(markdown: string, wanted: string): Array<string> {
	const near = prefixed(headings(markdown), wanted)
	const listed = near.length > 0 ? near : prefixed(labels(markdown), wanted)

	return listed.map((heading) => heading.title)
}

function read_optional(file_path: string): string | undefined {
	return file_reader.read_if_readable(file_path)
}

const document_section = {
	candidates,
	headings,
	read_optional,
	section,
	titles,
}

export type { Heading, Section }
export { document_section }
