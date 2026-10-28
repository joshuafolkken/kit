import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { review_readers_scan } from './review-readers-scan'

// The words a diff removed that prose may still name (joshuafolkken/kit#5287) — the self-check's
// "Prose matches the code" (`prompts/review.md`). Pure: `prose-stale-cli.ts` reads the diff and searches.
//
// **A removed line names four kinds of word**: an export name and an `UPPER_CASE` constant declared on a
// code file's removed line (the declaration reading is `review-readers-scan.ts`'s), a `josh x:y` command
// on any removed line, and a `.md` file's `#` heading. **A word the diff still writes is not removed**: an
// identifier or command any added line carries, a heading an added `.md` line still titles, and a command
// the registry still holds.

type TermKind = 'export' | 'constant' | 'command' | 'heading'

interface Term {
	kind: TermKind
	word: string
}

interface Reference {
	term: Term
	hits: ReadonlyArray<Hit>
	has_failed: boolean
}

interface Report {
	text: string
	exit_code: number
}

const CODE_FILE = /\.(?:ts|js)$/u
const MARKDOWN_EXTENSION = '.md'
const COMMAND = /\bjosh\s+(?<command>[a-z][\w-]*:[\w:-]+)/gu
const UPPER_CASE = /^[A-Z][A-Z\d_]*[A-Z\d]$/u
const HEADING = /^#{1,6} (?<text>.+)$/u
// A command token (`review:stops`) as well as an identifier, so one set answers both kinds.
const TOKEN = /[\w-]+(?::[\w-]+)*/gu
// A comment line of a code, shell or YAML file: `//`, `/*`, a block comment's `*`, or `#`.
const COMMENT_LINE = /^\s*(?:\/[/*]|\*|#)/u
const OK_LINE = 'ok'
const FOUND_EXIT = 1
const FAILED_EXIT = 2

function to_terms(kind: TermKind, words: ReadonlyArray<string>): Array<Term> {
	return words.map((word) => ({ kind, word }))
}

function code_terms(source: string): Array<Term> {
	const found = review_readers_scan.declarations(source)
	const direct = found.filter((entry) => entry.is_exported).map((entry) => entry.name)
	const listed = [...review_readers_scan.exported_names(source)]
	const constants = found.map((entry) => entry.name).filter((name) => UPPER_CASE.test(name))

	return [...to_terms('export', [...direct, ...listed]), ...to_terms('constant', constants)]
}

function command_terms(lines: ReadonlyArray<string>): Array<Term> {
	const commands = lines.flatMap((line) =>
		[...line.matchAll(COMMAND)].map((match) => match.groups?.['command'] ?? ''),
	)

	return to_terms('command', commands)
}

function headings(lines: ReadonlyArray<string>): Array<string> {
	const texts = lines.map((line) => HEADING.exec(line)?.groups?.['text']?.trim())

	return texts.filter((text): text is string => text !== undefined && text !== '')
}

function hunk_terms(hunk: Hunk): Array<Term> {
	const lines = hunk.old_lines
	const code = CODE_FILE.test(hunk.file) ? code_terms(lines.join('\n')) : []
	const titled = hunk.file.endsWith(MARKDOWN_EXTENSION) ? to_terms('heading', headings(lines)) : []

	return [...code, ...command_terms(lines), ...titled]
}

interface Kept {
	tokens: ReadonlySet<string>
	titles: ReadonlySet<string>
	registered: ReadonlySet<string>
}

function kept_of(hunks: ReadonlyArray<Hunk>, registered: ReadonlySet<string>): Kept {
	const added = hunks.flatMap((hunk) => hunk.new_lines ?? [])
	const markdown = hunks.filter((hunk) => hunk.file.endsWith(MARKDOWN_EXTENSION))
	const titles = headings(markdown.flatMap((hunk) => hunk.new_lines ?? []))
	const tokens = added.flatMap((line) => [...line.matchAll(TOKEN)].map((match) => match[0]))

	return { tokens: new Set(tokens), titles: new Set(titles), registered }
}

function is_removed(term: Term, kept: Kept): boolean {
	if (term.kind === 'heading') return !kept.titles.has(term.word)
	if (term.kind === 'command' && kept.registered.has(term.word)) return false

	return !kept.tokens.has(term.word)
}

// Each removed word once, in diff order; `registered` is the command registry's names.
function stale_terms(hunks: ReadonlyArray<Hunk>, registered: ReadonlySet<string>): Array<Term> {
	const kept = kept_of(hunks, registered)
	const unique = new Map(hunks.flatMap((hunk) => hunk_terms(hunk)).map((term) => [term.word, term]))

	return [...unique.values()].filter((term) => is_removed(term, kept))
}

// A heading is searched quoted, the way a `→ "Heading"` pointer names it; any other word as a whole word.
function pattern(term: Term): { target: string; flags: ReadonlyArray<string> } {
	if (term.kind === 'heading') return { target: `"${term.word}"`, flags: [] }

	return { target: term.word, flags: ['-w'] }
}

// Prose only: a `.md` line, or a comment line of any other searched file.
function is_prose(hit: Hit): boolean {
	return hit.path.endsWith(MARKDOWN_EXTENSION) || COMMENT_LINE.test(hit.excerpt)
}

function reference_lines(reference: Reference): Array<string> {
	const { kind, word } = reference.term

	if (reference.has_failed) return [`search failed: ${kind} ${word}`]

	return reference.hits
		.filter((hit) => is_prose(hit))
		.map((hit) => `${hit.path}:${hit.line} ${kind} ${word}`)
}

function exit_code_of(references: ReadonlyArray<Reference>, lines: ReadonlyArray<string>): number {
	if (references.some((reference) => reference.has_failed)) return FAILED_EXIT

	return lines.length > 0 ? FOUND_EXIT : 0
}

// `ok` only when every search answered and none found prose; a failed search is never read as none.
function report(references: ReadonlyArray<Reference>): Report {
	const lines = references.flatMap((reference) => reference_lines(reference))

	return {
		text: lines.length > 0 ? lines.join('\n') : OK_LINE,
		exit_code: exit_code_of(references, lines),
	}
}

const prose_stale_scan = { FAILED_EXIT, pattern, report, stale_terms }

export type { Reference, Term }
export { prose_stale_scan }
