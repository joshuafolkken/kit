import type { Hit } from '#scripts/git/git-grep-hits'
import type { Hunk } from '#scripts/test/test-pinned-logic'
import { review_readers_scan } from './review-readers-scan'

// The words a diff removed that prose may still name (joshuafolkken/kit#5287) — the self-check's
// "Prose matches the code" (`prompts/review.md`). Pure: `prose-stale-cli.ts` reads the diff and searches.
//
// **A removed line names four kinds of word**: a name (a top-level declaration, exported or not — a
// namespace object's member is a plain `function` — or an `export { … }` entry) and an `UPPER_CASE`
// constant on a code file's removed line (the declaration reading is `review-readers-scan.ts`'s), a `josh x:y` command
// on any removed line, and a `.md` file's `#` heading. **A word the diff still writes is not removed**: an
// identifier or command any added line carries, a heading an added `.md` line still titles, and a command
// the registry still holds. **A renamed declaration is removed unless an added line declares it again**
// (joshuafolkken/kit#5540): a hunk whose removed lines declare a name its added lines do not, beside
// one they declare anew, renamed it, and the old name an added comment or a local still carries as a
// token is stale all the same.

type TermKind = 'name' | 'constant' | 'command' | 'heading'

interface Term {
	kind: TermKind
	word: string
	renamed_to?: string
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
const MARKDOWN_FILE = /\.md$/u
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
	const declared = review_readers_scan.declarations(source).map((entry) => entry.name)
	const listed = [...review_readers_scan.exported_names(source)]
	const constants = declared.filter((name) => UPPER_CASE.test(name))
	const names = [...declared.filter((name) => !UPPER_CASE.test(name)), ...listed]

	return [...to_terms('name', names), ...to_terms('constant', constants)]
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

function declared_in(lines: ReadonlyArray<string>): Array<string> {
	return review_readers_scan.declarations(lines.join('\n')).map((entry) => entry.name)
}

// The old names paired, in order, with the names the same hunk's added lines declare in their place.
function renamed_terms(hunk: Hunk): Array<Term> {
	const before = declared_in(hunk.old_lines)
	const after = declared_in(hunk.new_lines ?? [])
	const gone = before.filter((name) => !after.includes(name))
	const fresh = after.filter((name) => !before.includes(name))

	return gone.flatMap((word, index): Array<Term> => {
		const renamed_to = fresh[index]

		if (renamed_to === undefined) return []

		return [{ kind: UPPER_CASE.test(word) ? 'constant' : 'name', word, renamed_to }]
	})
}

function hunk_terms(hunk: Hunk): Array<Term> {
	const lines = hunk.old_lines
	const is_code = CODE_FILE.test(hunk.file)
	const code = is_code ? [...code_terms(lines.join('\n')), ...renamed_terms(hunk)] : []
	const titled = hunk.file.endsWith(MARKDOWN_EXTENSION) ? to_terms('heading', headings(lines)) : []

	return [...code, ...command_terms(lines), ...titled]
}

interface Kept {
	tokens: ReadonlySet<string>
	titles: ReadonlySet<string>
	declared: ReadonlySet<string>
	registered: ReadonlySet<string>
}

function added_lines(hunks: ReadonlyArray<Hunk>, extension: RegExp): Array<string> {
	return hunks.filter((hunk) => extension.test(hunk.file)).flatMap((hunk) => hunk.new_lines ?? [])
}

function kept_of(hunks: ReadonlyArray<Hunk>, registered: ReadonlySet<string>): Kept {
	const added = hunks.flatMap((hunk) => hunk.new_lines ?? [])
	const titles = headings(added_lines(hunks, MARKDOWN_FILE))
	const declared = declared_in(added_lines(hunks, CODE_FILE))
	const tokens = added.flatMap((line) => [...line.matchAll(TOKEN)].map((match) => match[0]))

	return {
		tokens: new Set(tokens),
		titles: new Set(titles),
		declared: new Set(declared),
		registered,
	}
}

function is_removed(term: Term, kept: Kept): boolean {
	if (term.renamed_to !== undefined) return !kept.declared.has(term.word)
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
	const { kind, word, renamed_to } = reference.term
	const label = renamed_to === undefined ? word : `${word} (renamed to ${renamed_to})`

	if (reference.has_failed) return [`search failed: ${kind} ${label}`]

	return reference.hits
		.filter((hit) => is_prose(hit))
		.map((hit) => `${hit.path}:${hit.line} ${kind} ${label}`)
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
