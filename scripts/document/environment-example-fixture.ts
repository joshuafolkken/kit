import { josh_environment_file } from '#scripts/josh/josh-environment-file'

// `.env.example` held to `docs/environment-variables.md` (joshuafolkken/kit#7224). The docs table is
// the one source of each default and accepted value; `.env.example` copies them into comments, and
// these readers name every place the two have drifted apart.

interface ReferenceRow {
	key: string
	default_text: string
	code_values: ReadonlySet<string>
}

interface ExampleEntry {
	key: string
	value: string
	head: string
}

const SECTION_START = '## Variables you set'
const SECTION_END = '## Variables kit sets itself'
// The paragraph naming the variables only the real environment carries opens with this, and the
// list after it names the rest.
const SHELL_ONLY_OPENING = 'Every other command'
const LIST_MARKER = '- '
const SHELL_ONLY_KEY = /`(JOSH_[A-Z0-9_]+)`/gu
// A reference row opens with the variable's name in a code span; its cells are pipe-separated.
const REFERENCE_ROW = /^\| `([A-Z][A-Z0-9_]*)`/u
const CELL_SEPARATOR = '|'
// Before the first pipe, then name, required and default.
const DEFAULT_CELL_INDEX = 3
// A row kit keeps for compatibility, or one kit sets for its own children, is not offered for `.env`.
const NOT_OFFERED = /\| *(?:Legacy|Set by josh, never by hand)/u
const BLOCK_SEPARATOR = /\n\s*\n/u
const ASSIGNMENT = /^([A-Z][A-Z0-9_]*)=(.*)$/u
const DEFAULT_PREFIX = '# Default: '
const VALUES_SEPARATOR = ' · Values: '
const VALUE_LIST_SEPARATOR = ', '
const CODE_MARK = /`/gu
// An accepted value is one the row writes in a code span, alone or in a list such as
// `planning,completion` — never a word of its prose.
const CODE_SPAN = /`([^`]+)`/gu
const CODE_VALUE_SEPARATOR = /[\s,/]+/u
// The docs default may be followed by a qualifier, never by more of the value itself.
const QUALIFIER_SEPARATOR = ' '

function by_name(left: string, right: string): number {
	return left.localeCompare(right)
}

function plain(text: string): string {
	return text.replaceAll(CODE_MARK, '')
}

function settable_section(document: string): string {
	const start = document.indexOf(SECTION_START)

	return document.slice(start, document.indexOf(SECTION_END, start))
}

function is_list_or_blank(line: string): boolean {
	return line.trim() === '' || line.startsWith(LIST_MARKER)
}

// The opening line and the list after it, up to the first line of the next paragraph.
function shell_only_text(document: string): string {
	const lines = document.split('\n')
	const start = lines.findIndex((line) => line.startsWith(SHELL_ONLY_OPENING))
	const rest = lines.slice(start + 1)
	const end = rest.findIndex((line) => !is_list_or_blank(line))

	return [lines[start] ?? '', ...rest.slice(0, end)].join('\n')
}

function shell_only_keys(document: string): ReadonlySet<string> {
	const keys = [...shell_only_text(document).matchAll(SHELL_ONLY_KEY)]

	return new Set(keys.map((match) => match[1] ?? ''))
}

function code_values(line: string): ReadonlySet<string> {
	const spans = [...line.matchAll(CODE_SPAN)].map((match) => match[1] ?? '')

	return new Set(spans.flatMap((span) => span.split(CODE_VALUE_SEPARATOR)))
}

function reference_row(line: string): ReferenceRow | undefined {
	const [, key = ''] = REFERENCE_ROW.exec(line) ?? []

	if (key === '') return undefined

	const default_cell = line.split(CELL_SEPARATOR).at(DEFAULT_CELL_INDEX) ?? ''

	return { key, default_text: plain(default_cell).trim(), code_values: code_values(line) }
}

function is_offered(line: string, shell_only: ReadonlySet<string>): boolean {
	const row = reference_row(line)

	if (row === undefined || shell_only.has(row.key)) return false

	return !josh_environment_file.is_launch_only_key(row.key) && !NOT_OFFERED.test(line)
}

// The rows of "Variables you set" a `.env` line can set: the shell-only, launch-only, legacy and
// josh-set rows left out.
function offered_rows(document: string): Array<ReferenceRow> {
	const shell_only = shell_only_keys(document)

	return settable_section(document)
		.split('\n')
		.filter((line) => is_offered(line, shell_only))
		.map((line) => reference_row(line))
		.filter((row) => row !== undefined)
}

function assignment(line: string): ReadonlyArray<string> {
	return ASSIGNMENT.exec(line) ?? []
}

// A block — the lines between two blank ones — is an entry when it ends in a `KEY=` line; its first
// line is the one that carries the default.
function example_entry(block: string): ExampleEntry | undefined {
	const lines = block.trim().split('\n')
	const [, key, value = ''] = assignment(lines.at(-1) ?? '')

	return key === undefined ? undefined : { key, value, head: lines[0] ?? '' }
}

function example_entries(example: string): Array<ExampleEntry> {
	return example
		.split(BLOCK_SEPARATOR)
		.map((block) => example_entry(block))
		.filter((entry) => entry !== undefined)
}

function key_drift(expected: ReadonlyArray<string>, listed: ReadonlyArray<string>): Array<string> {
	const missing = expected.filter((key) => !listed.includes(key)).map((key) => `missing: ${key}`)
	const extra = listed.filter((key) => !expected.includes(key)).map((key) => `extra: ${key}`)

	return [...missing, ...extra].toSorted(by_name)
}

function value_drift(entry: ExampleEntry, values: string, row: ReferenceRow): Array<string> {
	return values
		.split(VALUE_LIST_SEPARATOR)
		.filter((value) => !row.code_values.has(value))
		.map((value) => `${entry.key}: value ${value} is not in the docs row`)
}

function is_reference_default(default_text: string, reference_default: string): boolean {
	return (
		default_text === reference_default ||
		default_text.startsWith(`${reference_default}${QUALIFIER_SEPARATOR}`)
	)
}

function head_drift(entry: ExampleEntry, row: ReferenceRow): Array<string> {
	if (!entry.head.startsWith(DEFAULT_PREFIX)) return [`${entry.key}: no ${DEFAULT_PREFIX}line`]

	const [default_text = '', values] = entry.head
		.slice(DEFAULT_PREFIX.length)
		.split(VALUES_SEPARATOR)
	const default_problem = is_reference_default(default_text, row.default_text)
		? []
		: [`${entry.key}: default ${default_text} is not the docs ${row.default_text}`]

	return [...default_problem, ...(values === undefined ? [] : value_drift(entry, values, row))]
}

function entry_drift(entry: ExampleEntry, rows: ReadonlyArray<ReferenceRow>): Array<string> {
	const row = rows.find((candidate) => candidate.key === entry.key)
	const set_value = entry.value === '' ? [] : [`${entry.key}: ships a value`]

	return row === undefined ? set_value : [...set_value, ...head_drift(entry, row)]
}

// Every place `.env.example` and the docs table disagree, as one line each; empty when they agree.
function environment_example_drift(document: string, example: string): Array<string> {
	const rows = offered_rows(document)
	const entries = example_entries(example)
	const keys = key_drift(
		rows.map((row) => row.key),
		entries.map((entry) => entry.key),
	)

	return [...keys, ...entries.flatMap((entry) => entry_drift(entry, rows))]
}

const environment_example_fixture = {
	environment_example_drift,
	example_entries,
}

export { environment_example_fixture }
