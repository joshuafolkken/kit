// What a workflow entry point reads before it does anything, and what that costs
// (joshuafolkken/kit#1776).
//
// **The entry read was the largest fixed cost a run had, and nothing measured it.** Measured on the
// `queue` parent of 2026-09-11: 159,323 billed input tokens per request at 16 requests, with the
// whole of those 16 requests spent reading the mandated documents and nothing implemented. The
// number could only be obtained after the fact, from a transcript, which is no use to the run that
// is about to pay it.
//
// **The set is derived, never transcribed.** The files come from `SKILL.md` → "1. Which file to
// read", the table a run reads first anyway, and the sections come from the `` `X.md` → "Heading" ``
// references those files actually carry. A hand-written copy of either would be the clone
// `CLAUDE.md` prohibits, and it would drift the first time a row moved.

import path from 'node:path'
import { cost_tokens } from '#scripts/cost/cost-tokens'
import { document_section, type Section } from './document-section'

const SKILL_DIRECTORY = path.join('.claude', 'skills', 'workflow-commands')
const SKILL_FILE = 'SKILL.md'
const TABLE_SECTION = '1. Which file to read'
const NOTHING = 0
const ONE_LINE = 1

// **`kickoff` is the one entry that reaches neither gate document, and that is `SKILL.md` §1's own
// sentence rather than a judgement made here**: it never implements, so it never reaches the
// dependency-update step `latest-gate.md` governs nor the verification gate `eval-gate.md` does.
const PLAN_ONLY_ENTRY = 'kickoff'
const GATE_FILES: ReadonlyArray<string> = ['latest-gate.md', 'eval-gate.md']

const TABLE_ROW = /^\|(?<entry>[^|]+)\|(?<files>[^|]+)\|\s*$/u
const MARKDOWN_NAME = /`(?<name>[\w.-]+\.md)`/gu
// The entry keyword is the first backticked word of the row's first column — `` `queue #N1 #N2 …` ``
// and `` `kickoff` / `kickoff #N` `` both yield the keyword and nothing else.
const ENTRY_KEYWORD = /`(?<keyword>[a-z]+)/u
// The cross-reference form every one of these documents uses. The arrow is the one character that
// distinguishes a pointer at a section from a mention of a file.
const SECTION_REFERENCE = /`(?<file>[\w.-]+\.md)` *→ *"(?<heading>[^"]+)"/gu
const WHITESPACE_RUN = /\s+/gu

interface SectionReference {
	file: string
	heading: string
}

interface Cost {
	bytes: number
	tokens: number
}

interface SectionCost extends SectionReference {
	cost: Cost
	is_resolved: boolean
}

interface FileCost {
	file: string
	cost: Cost
}

interface TableRow {
	keyword: string
	files: ReadonlyArray<string>
}

interface ReadSet {
	entry: string
	files: ReadonlyArray<string>
	sections: ReadonlyArray<SectionReference>
}

interface ReadSetCost {
	entry: string
	files: ReadonlyArray<FileCost>
	sections: ReadonlyArray<SectionCost>
	// Every file in the set read in full, the referenced ones included — what a run pays with no way
	// to fetch a heading.
	whole: Cost
	// The set's own files in full plus the referenced sections alone — what it pays with one.
	scoped: Cost
}

function document_path(root: string, name: string): string {
	return path.join(root, SKILL_DIRECTORY, name)
}

function read_document(root: string, name: string): string {
	return document_section.read_optional(document_path(root, name)) ?? ''
}

function unique(names: ReadonlyArray<string>): Array<string> {
	return [...new Set(names)]
}

// **Scanned with `exec` rather than collected from `matchAll`.** `Iterator#toArray` is outside this
// project's lib, and both ways of materializing the iterator are refused —
// `unicorn/prefer-iterator-to-array` rejects the spread, and the `--fix` that rewrites a `for…of`
// push loop puts the spread straight back. A fresh `RegExp` rather than the shared one, so the
// caller's `lastIndex` is never carried between two scans of different documents.
function all_matches(text: string, pattern: RegExp): Array<RegExpExecArray> {
	const scanner = new RegExp(pattern.source, pattern.flags)
	const found: Array<RegExpExecArray> = []
	let match = scanner.exec(text)

	while (match !== null) {
		found.push(match)
		match = scanner.exec(text)
	}

	return found
}

function group_of(match: RegExpExecArray, name: string): string {
	return match.groups?.[name] ?? ''
}

function names_in(text: string): Array<string> {
	return all_matches(text, MARKDOWN_NAME).map((match) => group_of(match, 'name'))
}

function columns_of(line: string): { entry: string; files: string } | undefined {
	const groups = TABLE_ROW.exec(line)?.groups

	if (groups === undefined) return undefined

	// Destructured rather than read as properties: `noPropertyAccessFromIndexSignature` refuses
	// `groups.entry`, and ESLint's `dot-notation` fix turns `groups['entry']` straight back into it.
	const { entry = '', files = '' } = groups

	return { entry, files }
}

function to_row(line: string): TableRow | undefined {
	const columns = columns_of(line)

	if (columns === undefined) return undefined

	const { keyword } = ENTRY_KEYWORD.exec(columns.entry)?.groups ?? {}

	return keyword === undefined ? undefined : { keyword, files: names_in(columns.files) }
}

function push_row(rows: Map<string, ReadonlyArray<string>>, line: string): void {
	const row = to_row(line)

	// A row with no `.md` in its second column is the header separator, not an entry.
	if (row !== undefined && row.files.length > NOTHING) rows.set(row.keyword, row.files)
}

// The table lives inside `SKILL.md` → "1. Which file to read", so the parse is scoped to that
// section: every other table in the document would otherwise contribute rows of its own.
function table_rows(root: string): Map<string, ReadonlyArray<string>> {
	const rows = new Map<string, ReadonlyArray<string>>()
	const found = document_section.section(read_document(root, SKILL_FILE), TABLE_SECTION)
	const lines = (found?.text ?? '').split('\n')

	for (const line of lines) push_row(rows, line)

	return rows
}

function gate_files(entry: string): ReadonlyArray<string> {
	return entry === PLAN_ONLY_ENTRY ? [] : GATE_FILES
}

function files_for(root: string, entry: string): ReadonlyArray<string> {
	const declared = table_rows(root).get(entry) ?? []

	return unique([SKILL_FILE, ...declared, ...gate_files(entry)])
}

// A reference that wrapped across a source line carries the newline and the next line's indent
// inside its quotes, so it is folded before it is compared with a heading.
function fold(text: string): string {
	return text.replaceAll(WHITESPACE_RUN, ' ').trim()
}

function is_sibling_document(root: string, name: string): boolean {
	return document_section.read_optional(document_path(root, name)) !== undefined
}

// **Only the references that point *out* of the set are counted.** A pointer into a file the entry
// already reads in full costs nothing extra, and counting it would make the saving look larger than
// it is. **And only into a sibling workflow document**: a pointer at `CLAUDE.md` names text that is
// resident on every request already, and one at a `prompts/` topic names a file reached on its own
// step rather than at the entry.
function is_counted(
	root: string,
	reference: SectionReference,
	files: ReadonlyArray<string>,
): boolean {
	return !files.includes(reference.file) && is_sibling_document(root, reference.file)
}

function to_reference(match: RegExpExecArray): SectionReference {
	return { file: group_of(match, 'file'), heading: fold(group_of(match, 'heading')) }
}

function references_from(
	root: string,
	text: string,
	files: ReadonlyArray<string>,
): Array<SectionReference> {
	return all_matches(text, SECTION_REFERENCE)
		.map((match) => to_reference(match))
		.filter((reference) => is_counted(root, reference, files))
}

function sort_key(reference: SectionReference): string {
	return `${reference.file} ${reference.heading}`
}

function dedupe(references: ReadonlyArray<SectionReference>): Array<SectionReference> {
	const seen = new Map<string, SectionReference>()

	for (const reference of references) seen.set(sort_key(reference), reference)

	return [...seen].map(([, reference]) => reference)
}

// **`SKILL.md`'s own cross-references are not part of the entry read, and leaving them out is the
// difference between measuring the entry and measuring the whole document set.** §2 states each
// shared rule in full and then names the single source, so following one at the entry re-reads text
// the run already holds — and several of them are `epicrun.md` sections a `kickoff` or a `queue`
// never reaches at all. A command file's references are the other kind: `fullrun.md` says outright
// that the procedure "is not repeated here", so the section it names is reading this entry owes.
function sections_for(root: string, files: ReadonlyArray<string>): Array<SectionReference> {
	const found = files
		.filter((file) => file !== SKILL_FILE)
		.flatMap((file) => references_from(root, read_document(root, file), files))

	return dedupe(found).toSorted((left, right) => sort_key(left).localeCompare(sort_key(right)))
}

function read_set(root: string, entry: string): ReadSet {
	const files = files_for(root, entry)

	return { entry, files, sections: sections_for(root, files) }
}

function cost_of(text: string): Cost {
	return { bytes: Buffer.byteLength(text, 'utf8'), tokens: cost_tokens.estimate(text) }
}

function total(costs: ReadonlyArray<Cost>): Cost {
	const running = { bytes: NOTHING, tokens: NOTHING }

	for (const cost of costs) {
		running.bytes += cost.bytes
		running.tokens += cost.tokens
	}

	return running
}

function section_cost(root: string, reference: SectionReference): SectionCost {
	const found = document_section.section(read_document(root, reference.file), reference.heading)

	return {
		...reference,
		// **An unresolvable reference is charged at the whole file.** Reporting it at zero would let a
		// broken pointer read as a saving, which is the one direction this measurement must not move.
		cost: cost_of(found?.text ?? read_document(root, reference.file)),
		is_resolved: found !== undefined,
	}
}

function referenced_cost(root: string, sections: ReadonlyArray<SectionReference>): Cost {
	const files = unique(sections.map((reference) => reference.file))

	return total(files.map((file) => cost_of(read_document(root, file))))
}

function headings_for(sections: ReadonlyArray<SectionReference>, file: string): Array<string> {
	return sections.filter((reference) => reference.file === file).map((one) => one.heading)
}

function add_range(charged: Set<number>, found: Section): void {
	for (let index = found.first_line; index <= found.last_line; index += ONE_LINE) charged.add(index)
}

// `undefined` the moment one heading does not resolve, because that reference is charged at its whole
// file and there is then nothing to union.
function charged_lines(markdown: string, headings: ReadonlyArray<string>): Set<number> | undefined {
	const charged = new Set<number>()

	for (const heading of headings) {
		const found = document_section.section(markdown, heading)

		if (found === undefined) return undefined

		add_range(charged, found)
	}

	return charged
}

// **Charged per file over the union of the lines its references cover, never per reference.**
// Summing the references instead double-counts the two ways one file can be cited twice — two
// unresolved headings each charged at the whole file, and a `##` section cited beside one of its own
// `###` children, which `section()` already returns inside the parent. Either one could push the
// scoped figure above the whole one and print a *negative* saving, which is the single direction this
// measurement must not be able to move (joshuafolkken/kit#1776 review round 1).
function file_scoped_cost(root: string, file: string, headings: ReadonlyArray<string>): Cost {
	const markdown = read_document(root, file)
	const charged = charged_lines(markdown, headings)

	if (charged === undefined) return cost_of(markdown)

	const lines = markdown.split('\n')

	return cost_of([...charged].map((index) => lines[index] ?? '').join('\n'))
}

function scoped_cost(root: string, sections: ReadonlyArray<SectionReference>): Cost {
	const files = unique(sections.map((reference) => reference.file))

	return total(files.map((file) => file_scoped_cost(root, file, headings_for(sections, file))))
}

function costed(root: string, entry: string): ReadSetCost {
	const { files, sections } = read_set(root, entry)
	const file_costs = files.map((file) => ({ file, cost: cost_of(read_document(root, file)) }))
	const section_costs = sections.map((reference) => section_cost(root, reference))
	const own = total(file_costs.map((row) => row.cost))

	return {
		entry,
		files: file_costs,
		sections: section_costs,
		whole: total([own, referenced_cost(root, sections)]),
		scoped: total([own, scoped_cost(root, sections)]),
	}
}

function entries(root: string): Array<string> {
	return [...table_rows(root)].map(([keyword]) => keyword)
}

const entry_read_set = {
	GATE_FILES,
	PLAN_ONLY_ENTRY,
	SECTION_REFERENCE,
	SKILL_DIRECTORY,
	SKILL_FILE,
	TABLE_SECTION,
	cost_of,
	costed,
	document_path,
	entries,
	read_set,
	total,
}

export type { Cost, FileCost, ReadSet, ReadSetCost, SectionCost, SectionReference }
export { entry_read_set }
