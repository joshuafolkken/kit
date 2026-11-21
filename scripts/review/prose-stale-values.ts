import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'

// The values and flags a diff changed whose old form prose may still write (joshuafolkken/kit#7881) —
// `prose-stale-scan.ts` reads the names a diff removed; this module reads what a kept name now holds.
//
// **A changed value** is a top-level `const` whose number or string literal a hunk's removed line writes
// and its added line writes differently under the same name. **A removed flag** is a `--flag` token a
// code file's removed line writes; the scan keeps it when an added line or live code still writes it.
// **An old value counts only where prose uses it in the constant's sense**, so a `2` or a `'name'` that
// means something else is not stale. It is read on a `.md` line, or on a comment of the file declaring
// the constant — another module's comment speaks of its own values. A number must stand alone (not a
// decimal, a version, an `#N` or a path part) on a line naming the constant or the stem of each of its
// words (`FAILED_EXIT` → `fail…`, `exit…`), so another command's `exits 2` is not this one's. A string
// must be quoted or in backticks, or on a line naming the constant. A flag counts as a whole `--flag`
// token.

interface ChangedValue {
	file: string
	constant: string
	before: string
	after: string
}

// What `is_use` reads of a term: a value carries its constant and the file declaring it, a flag neither.
interface Written {
	word: string
	constant?: string
	file?: string
}

// A top-level declaration, typed or not; `LITERAL` then reads its right side.
const DECLARATION = /^(?:export )?const (?<name>[\w$]+)(?::[^=]+| )= (?<literal>.+)$/u
const LITERAL = /^(?:-?\d[\d_.]*|'[^'\\]*'|"[^"\\]*")$/u
const NUMBER = /^-?\d+(?:\.\d+)?$/u
const FLAG = /(?<![\w-])(?<flag>--[a-z][\w-]*)/gu
const QUOTE = /^['"]|['"]$/gu
const DIGIT_GROUP = /_/gu
const NAME_WORD_SPLIT = /_|(?<=[a-z])(?=[A-Z])/u
const NAME_WORD = /^[a-z\d]{3,}$/u
const QUOTES = ['`', "'", '"']
const STEM_LENGTH = 4
const MARKDOWN_EXTENSION = '.md'

// A literal as prose writes it: unquoted, a number without its `_` digit groups.
function value_of(literal: string | undefined): string | undefined {
	if (literal === undefined || !LITERAL.test(literal)) return undefined

	return literal.replaceAll(QUOTE, '').replaceAll(DIGIT_GROUP, '')
}

function literal_of(line: string): [string, string] | undefined {
	const groups = DECLARATION.exec(line)?.groups ?? {}
	const value = value_of(groups['literal'])

	if (value === undefined) return undefined

	return [groups['name'] ?? '', value]
}

function declared_values(lines: ReadonlyArray<string>): Map<string, string> {
	const pairs = lines.map((line) => literal_of(line))

	return new Map(pairs.filter((pair) => pair !== undefined))
}

// An empty string names nothing, and a flag-valued constant is the flag rule's.
function is_searchable(value: string): boolean {
	return value !== '' && !value.startsWith('--')
}

function hunk_changes(hunk: Hunk): Array<ChangedValue> {
	const after = declared_values(hunk.new_lines ?? [])

	const changes = [...declared_values(hunk.old_lines)].map(([constant, before]) => ({
		file: hunk.file,
		constant,
		before,
		after: after.get(constant) ?? before,
	}))

	return changes.filter((change) => change.after !== change.before && is_searchable(change.before))
}

// `hunks` are the change's non-test code hunks.
function changed(hunks: ReadonlyArray<Hunk>): Array<ChangedValue> {
	return hunks.flatMap((hunk) => hunk_changes(hunk))
}

function flags(lines: ReadonlyArray<string>): Array<string> {
	return lines.flatMap((line) =>
		[...line.matchAll(FLAG)].map((match) => match.groups?.['flag'] ?? ''),
	)
}

// Each word of the name cut to its stem, so `FAILED_EXIT` reads `failure` and `exits` as well.
function name_stems(constant: string): Array<string> {
	return constant
		.split(NAME_WORD_SPLIT)
		.map((word) => word.toLowerCase())
		.filter((word) => NAME_WORD.test(word))
		.map((word) => word.slice(0, STEM_LENGTH))
}

function names_constant(constant: string, excerpt: string): boolean {
	const lower = excerpt.toLowerCase()
	const stems = name_stems(constant)

	if (excerpt.includes(constant)) return true

	return (
		stems.length > 0 && stems.every((stem) => new RegExp(String.raw`\b${stem}`, 'u').test(lower))
	)
}

function stands_alone(number: string, excerpt: string): boolean {
	const escaped = number.replaceAll('.', String.raw`\.`)

	return new RegExp(String.raw`(?<![\w.#/:-])${escaped}(?![\w/]|[.,:]\d)`, 'u').test(excerpt)
}

function is_value_use(word: string, constant: string, excerpt: string): boolean {
	if (NUMBER.test(word)) return stands_alone(word, excerpt) && names_constant(constant, excerpt)

	return (
		excerpt.includes(constant) ||
		QUOTES.some((quote) => excerpt.includes(`${quote}${word}${quote}`))
	)
}

// Another code file's comment speaks of its own values; a `.md` line may speak of any module's.
function is_read_in(file: string | undefined, path: string): boolean {
	return path.endsWith(MARKDOWN_EXTENSION) || path === file
}

function is_use({ word, constant, file }: Written, hit: Hit): boolean {
	if (constant === undefined) {
		return new RegExp(String.raw`(?<![\w-])${word}(?![\w-])`, 'u').test(hit.excerpt)
	}

	return is_read_in(file, hit.path) && is_value_use(word, constant, hit.excerpt)
}

const prose_stale_values = { changed, flags, is_use }

export type { ChangedValue }
export { prose_stale_values }
