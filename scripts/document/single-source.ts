// The single-source check a document-rule test runs to keep one piece of prose in one place
// (joshuafolkken/kit#2188). Epic #2166 trims the entry read by turning prose a reader interprets into
// commands and reference-only pointers; that only holds if the body moved to its command's help does
// not get pasted back into the prose. This is the framework a later child pins each such move with —
// give it the body marker and the file allowed to carry it, and it names every other document that
// still carries the body.
//
// **It is a pure function of the corpus, so the reader is injected.** Reading the repository is the
// test's job (`ai-document-fixture.read_repo_file`); this module takes a `read` and answers from what
// it returns, so the same logic verifies synthetic inputs in its own test and the real corpus in a
// document-rule suite.

const SINGLE = 1

interface SingleSourceRule {
	// The prose fragment that must live in exactly one place.
	marker: string
	// The one document allowed to carry it; every reference elsewhere points here rather than copying.
	canonical: string
}

type ReadDocument = (document_path: string) => string

// Prose is re-wrapped by the formatter, so a marker that spans a line break would miss on a reflow
// that changed nothing. Collapsing whitespace on both sides pins the words rather than the column,
// exactly as `read_unwrapped` does for the marker suites.
function collapsed(text: string): string {
	return text.replaceAll(/\s+/gu, ' ')
}

function carries(text: string, marker: string): boolean {
	return collapsed(text).includes(collapsed(marker))
}

// Every document whose text carries the marker, canonical included — the primitive the two checks
// below read from.
function carriers(
	marker: string,
	documents: ReadonlyArray<string>,
	read: ReadDocument,
): Array<string> {
	return documents.filter((document_path) => carries(read(document_path), marker))
}

// The documents that carry the body but are not its canonical home — a non-empty result is the
// violation a single-source suite asserts against.
function violations(
	rule: SingleSourceRule,
	documents: ReadonlyArray<string>,
	read: ReadDocument,
): Array<string> {
	return carriers(rule.marker, documents, read).filter(
		(document_path) => document_path !== rule.canonical,
	)
}

// True only when the canonical carries the body and nothing else does. A body missing from its
// canonical home is as wrong as one copied elsewhere — a pointer left with nothing to point at — so
// both halves are checked here rather than only the copies.
function is_single_sourced(
	rule: SingleSourceRule,
	documents: ReadonlyArray<string>,
	read: ReadDocument,
): boolean {
	const found = carriers(rule.marker, documents, read)

	return found.length === SINGLE && found[0] === rule.canonical
}

const single_source = { carriers, is_single_sourced, violations }

export type { ReadDocument, SingleSourceRule }
export { single_source }
