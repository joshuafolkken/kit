import type { Fingerprint } from './clone-aggregate'

// Turning source text into fingerprints (joshuafolkken/kit#2217).
//
// A fingerprint is a block of consecutive significant lines, each normalized so that reindentation
// and reflowed whitespace do not hide a copy. Blank lines and comment-only lines are dropped before
// blocking, so a copied block still matches after its comments are edited. The block is the joined
// normalized text itself — two blocks are the same clone exactly when that text is equal — which needs
// no parser, so it works across package boundaries and file types the way the rule requires.
//
// The blocks are consecutive and non-overlapping (a stride equal to the window), so one copied region
// counts once rather than once per sliding offset: the number is a count of duplicated blocks, not an
// inflated tally of every window that happened to overlap the copy. The cost is that a copy whose
// significant lines do not align to the same block boundary in both files can be missed — an
// acceptable trade for a count that means what it says.

// How many significant lines make a block. Small enough to catch a copied helper, large enough that a
// run of ordinary statements does not match by accident.
const WINDOW_SIZE = 6
const LINE_SEPARATOR = '\n'
// Lines that begin a comment once trimmed. `*` covers the continuation lines of a block comment.
const COMMENT_PREFIXES = ['//', '/*', '*']

// A significant line: its normalized text and its 1-based line number in the original source.
interface SourceLine {
	text: string
	number: number
}

// Where a file's fingerprints belong, minus the line number the window fills in.
interface FileSite {
	repo: string
	file: string
}

// Collapse leading, trailing and interior whitespace so formatting differences do not defeat a match.
function normalize(text: string): string {
	return text.trim().replaceAll(/\s+/gu, ' ')
}

// Whether a line carries code — non-blank and not the start of a comment.
function is_significant(text: string): boolean {
	const trimmed = text.trim()
	if (trimmed.length === 0) return false

	return COMMENT_PREFIXES.every((prefix) => !trimmed.startsWith(prefix))
}

// The significant lines of a source, each normalized and tagged with its original line number.
function significant_lines(source: string): Array<SourceLine> {
	const lines: Array<SourceLine> = []

	for (const [index, text] of source.split(LINE_SEPARATOR).entries()) {
		if (is_significant(text)) lines.push({ text: normalize(text), number: index + 1 })
	}

	return lines
}

// One window's fingerprint, or nothing when the slice came up empty.
function window_fingerprint(
	window: ReadonlyArray<SourceLine>,
	site: FileSite,
): Fingerprint | undefined {
	const [first] = window
	if (first === undefined) return undefined

	const hash = window.map((line) => line.text).join(LINE_SEPARATOR)

	return { hash, site: { repo: site.repo, file: site.file, line: first.number } }
}

// Every non-overlapping block fingerprint of a source, keyed to `site`. A source with fewer than
// `WINDOW_SIZE` significant lines yields none.
function fingerprints_for(source: string, site: FileSite): Array<Fingerprint> {
	const lines = significant_lines(source)
	const fingerprints: Array<Fingerprint> = []

	for (let start = 0; start + WINDOW_SIZE <= lines.length; start += WINDOW_SIZE) {
		const fingerprint = window_fingerprint(lines.slice(start, start + WINDOW_SIZE), site)
		if (fingerprint !== undefined) fingerprints.push(fingerprint)
	}

	return fingerprints
}

const clone_fingerprint = {
	WINDOW_SIZE,
	normalize,
	is_significant,
	significant_lines,
	fingerprints_for,
}

export type { FileSite }
export { clone_fingerprint }
