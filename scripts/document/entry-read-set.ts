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

import { existsSync } from 'node:fs'
import path from 'node:path'
import { cost_tokens } from '#scripts/cost-runtime/cost-tokens'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { bash_output_cap_reader } from './bash-output-cap'
import { document_section, type Section } from './document-section'
import { read_set_point_of_use } from './read-set-point-of-use'

const { POINT_OF_USE_FILES, POINT_OF_USE_BY_ENTRY, is_point_of_use, point_of_use_files } =
	read_set_point_of_use

const SKILL_DIRECTORY = path.join('.claude', 'skills', 'workflow-commands')
const SKILL_FILE = 'SKILL.md'
const TABLE_SECTION = '1. Which file to read'
const NOTHING = 0
const ONE_LINE = 1

// The point-of-use classification — which documents an entry names but reads only at a later step —
// is its own concern, split into `read-set-point-of-use.ts` in joshuafolkken/kit#2289. This file
// reads that classification to drop those files from the entry read and to cost them separately.

// The fetch cap a `cat` truncates at, and the harness default it falls back to, are read from
// `bash-output-cap.ts` — split out in joshuafolkken/kit#2161 to keep this file under its line ceiling.
// `section()` hands back a `##` heading's `###` children with it, so the table parse has to say
// where it stops — see `table_rows`.
const SUBSECTION_PREFIX = '### '

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
	// What the entry reads later: the section named in the trigger table, or the whole document when
	// none is named. Listed rather than dropped so the reported total has no hidden cost.
	point_of_use: ReadonlyArray<SectionCost>
	// The character cap a Bash result is truncated at, so the report can say which of the files above
	// a `cat` cannot deliver whole. **Compared against each file's byte count, which is a deliberate
	// conservative proxy**: these documents are heavily non-ASCII, so bytes run above characters and
	// the comparison can only over-mark, never under-mark. Over-marking costs nothing — the rule
	// beneath the report is one `Read` per file either way — while under-marking would invite the
	// `cat` that truncates.
	bash_output_cap: number
	// Every file in the set read in full, the referenced ones included — what a run pays with no way
	// to fetch a heading.
	whole: Cost
	// The set's own files in full plus the referenced sections alone — what it pays with one.
	scoped: Cost
}

// **Use the running package's skill before a consumer's legacy copy.** Old copied skill bodies
// can remain after the plugin migration, including when josh is installed globally. Reading them
// would measure old instructions against the package's current budget. A fixture without a project
// manifest keeps its own skill tree, so tests can supply alternate documents.
function document_path(root: string, name: string): string {
	const in_project = path.join(root, SKILL_DIRECTORY, name)
	const in_package = path.join(PACKAGE_DIR, SKILL_DIRECTORY, name)
	const project_manifest = path.join(root, 'package.json')

	if (root !== '' && existsSync(project_manifest) && existsSync(in_package)) return in_package

	return existsSync(in_project) ? in_project : in_package
}

function read_document(root: string, name: string): string {
	return document_section.read_optional(document_path(root, name)) ?? ''
}

function unique(names: ReadonlyArray<string>): Array<string> {
	return [...new Set(names)]
}

// **Scanned with `exec` rather than collected from `matchAll`.** A fresh `RegExp` rather than the
// shared one, so the caller's `lastIndex` is never carried between two scans of different documents.
//
// This spelling used to be forced rather than chosen: `unicorn/prefer-iterator-to-array` rejected
// the spread while the `--fix` for a `for…of` push loop put the spread straight back, so neither
// form was green. joshuafolkken/kit#1783 removed that contradiction — the spread is accepted now —
// and rewriting this helper was left outside that Issue's scope, so the loop stands on the
// `lastIndex` isolation above alone.
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
	// `groups.entry`. The bracket form was refused too, until joshuafolkken/kit#1783 switched off the
	// `dot-notation` fix that rewrote it back — so this is a choice now rather than the only spelling.
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
//
// **And it stops at the section's first subsection.** `section()` returns a `##` heading's `###`
// children with it, and joshuafolkken/kit#1797 put a second two-column table under one of them — the
// point-of-use triggers. Its rows parse as entry rows, and only the "no `.md` in the second column"
// guard kept `latest`, `eval` and `followup` out of the keyword set; one edit adding a document name
// to a trigger cell would have registered them as entry points. The stop makes that explicit rather
// than incidental.
function table_rows(root: string): Map<string, ReadonlyArray<string>> {
	const rows = new Map<string, ReadonlyArray<string>>()
	const found = document_section.section(read_document(root, SKILL_FILE), TABLE_SECTION)
	const lines = (found?.text ?? '').split('\n')

	for (const line of lines) {
		if (line.startsWith(SUBSECTION_PREFIX)) break

		push_row(rows, line)
	}

	return rows
}

// **A point-of-use document is dropped from the set wherever a table row still names it**, so the
// entry cost cannot be reported as including a file the entry does not read. The drop is per entry:
// `backlogrun` lists `fullrun.md` and `split-assessment.md` in its row to document that a child reads
// them, and the per-entry map takes them back out of the parent's entry cost.
function files_for(root: string, entry: string): ReadonlyArray<string> {
	const declared = table_rows(root).get(entry) ?? []

	return unique([SKILL_FILE, ...declared]).filter((file) => !is_point_of_use(entry, file))
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
//
// **A pointer into a point-of-use document is not an entry cost either** (joshuafolkken/kit#1797).
// Counting one would put `followup.md` straight back into the entry figure under another name, when
// the whole point is that the run reaches it half an hour later — and then only by fetching it whole
// at that moment, which is a cost of that step rather than of the entry.
function is_counted(
	root: string,
	entry: string,
	reference: SectionReference,
	files: ReadonlyArray<string>,
): boolean {
	if (is_point_of_use(entry, reference.file)) return false

	return !files.includes(reference.file) && is_sibling_document(root, reference.file)
}

function to_reference(match: RegExpExecArray): SectionReference {
	return { file: group_of(match, 'file'), heading: fold(group_of(match, 'heading')) }
}

function references_from(
	root: string,
	entry: string,
	text: string,
	files: ReadonlyArray<string>,
): Array<SectionReference> {
	return all_matches(text, SECTION_REFERENCE)
		.map((match) => to_reference(match))
		.filter((reference) => is_counted(root, entry, reference, files))
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
function sections_for(
	root: string,
	entry: string,
	files: ReadonlyArray<string>,
): Array<SectionReference> {
	const found = files
		.filter((file) => file !== SKILL_FILE)
		.flatMap((file) => references_from(root, entry, read_document(root, file), files))

	return dedupe(found).toSorted((left, right) => sort_key(left).localeCompare(sort_key(right)))
}

function read_set(root: string, entry: string): ReadSet {
	const files = files_for(root, entry)

	return { entry, files, sections: sections_for(root, entry, files) }
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

// **The union's charged lines are split into contiguous runs, and each run is costed on its own
// natural text.** Joining non-adjacent lines with `\n` into one string fabricates a token boundary at
// every gap the union skipped, so the estimate could drift a token *above* the per-reference sum even
// with no real overlap — a false negative saving the measurement must never print
// (joshuafolkken/kit#1934). A run is a maximal stretch of consecutive charged lines, which is exactly
// the contiguous text a reader of that section actually reads, so summing the runs both mirrors the
// real read and keeps `scoped` at or below the per-reference sum by construction.
function extend_or_start(runs: Array<Array<number>>, index: number): void {
	const current = runs.at(-1)

	if (current?.at(-1) === index - ONE_LINE) current.push(index)
	else runs.push([index])
}

function contiguous_runs(charged: ReadonlySet<number>): Array<Array<number>> {
	const runs: Array<Array<number>> = []
	const ascending = [...charged].toSorted((left, right) => left - right)

	for (const index of ascending) extend_or_start(runs, index)

	return runs
}

function run_text(lines: ReadonlyArray<string>, run: ReadonlyArray<number>): string {
	return run.map((index) => lines[index] ?? '').join('\n')
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

	return total(contiguous_runs(charged).map((run) => cost_of(run_text(lines, run))))
}

function scoped_cost(root: string, sections: ReadonlyArray<SectionReference>): Cost {
	const files = unique(sections.map((reference) => reference.file))

	return total(files.map((file) => file_scoped_cost(root, file, headings_for(sections, file))))
}

function file_costs(root: string, names: ReadonlyArray<string>): Array<FileCost> {
	return names.map((file) => ({ file, cost: cost_of(read_document(root, file)) }))
}

function point_of_use_cost(
	root: string,
	file: string,
	references: ReadonlyArray<SectionReference>,
): SectionCost {
	const reference = references.find((one) => one.file === file)

	if (reference !== undefined) return section_cost(root, reference)

	return { file, heading: '', cost: cost_of(read_document(root, file)), is_resolved: true }
}

function point_of_use_costs(root: string, entry: string): Array<SectionCost> {
	const found = document_section.section(read_document(root, SKILL_FILE), TABLE_SECTION)
	const references = all_matches(found?.text ?? '', SECTION_REFERENCE).map((match) =>
		to_reference(match),
	)

	return point_of_use_files(entry).map((file) => point_of_use_cost(root, file, references))
}

function costed(root: string, entry: string): ReadSetCost {
	const { files, sections } = read_set(root, entry)
	const own_costs = file_costs(root, files)
	const section_costs = sections.map((reference) => section_cost(root, reference))
	const own = total(own_costs.map((row) => row.cost))

	return {
		entry,
		files: own_costs,
		sections: section_costs,
		point_of_use: point_of_use_costs(root, entry),
		bash_output_cap: bash_output_cap_reader.bash_output_cap(root),
		whole: total([own, referenced_cost(root, sections)]),
		scoped: total([own, scoped_cost(root, sections)]),
	}
}

function entries(root: string): Array<string> {
	return [...table_rows(root)].map(([keyword]) => keyword)
}

const entry_read_set = {
	HARNESS_DEFAULT_CAP_CHARS: bash_output_cap_reader.HARNESS_DEFAULT_CAP_CHARS,
	POINT_OF_USE_BY_ENTRY,
	POINT_OF_USE_FILES,
	SECTION_REFERENCE,
	SKILL_DIRECTORY,
	SKILL_FILE,
	TABLE_SECTION,
	bash_output_cap: bash_output_cap_reader.bash_output_cap,
	cost_of,
	costed,
	document_path,
	entries,
	read_set,
	total,
}

export type { Cost, FileCost, ReadSet, ReadSetCost, SectionCost, SectionReference }
export { entry_read_set }
