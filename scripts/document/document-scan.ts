// Pulling machine-checkable references out of the distributed documents, so a few structural scans
// can replace the ~140 per-phrase marker suites the documents used to carry (joshuafolkken/kit#1923).
// Every function here is a pure string extractor: it takes document text and returns the references
// it names, which is what lets the scans that call it be checked on a synthetic string with a
// deliberately broken reference in it.

// A command reference, only inside a code span. `` `pnpm josh gate` `` and `` `josh review:brief` ``
// are the copy-and-paste form; the leading backtick keeps prose like "josh will decide" out, which
// would otherwise read "will" as a command name.
const COMMAND_PATTERN = /`(?:pnpm )?josh ([a-z][a-z0-9:-]+)/gu

// A label the documents operate on — applied (`labels[]=…`), removed (`…/labels/<name>`) or created
// (`labels -f name=…`). Prose that merely names a label is not scanned; a mistyped name only breaks
// where a command carries it.
const LABEL_PATTERN = /(?:labels\[\]=|\/labels\/|labels -f name=)([a-z][a-z0-9:_-]*)/gu

// A section reference: a markdown file in a code span, an arrow, and the cited heading in straight or
// Japanese quotes — `` `backlogrun-progress.md` → "The hand-off" ``.
const SECTION_PATTERN = /`([\w./-]+\.md)`\s*→\s*["「]([^"」]+)["」]/gu

// A relative markdown link target, with an optional `#anchor`. External `https://…` links carry no
// `.md`, so the pattern never matches them.
const LINK_PATTERN = /\]\(([\w./-]+\.md)(?:#[\w-]+)?\)/gu

// Filenames that appear in the documents as illustrations of the reference form itself, never as real
// targets — the doc-section explanation cites `` `path.md` → "Heading" `` and `` `X.md` → "Heading" ``.
const PLACEHOLDER_FILES: ReadonlySet<string> = new Set(['x.md', 'foo.md', 'file.md', 'path.md'])

function matches(text: string, pattern: RegExp): Array<RegExpMatchArray> {
	return [...text.matchAll(pattern)]
}

// A trailing colon is a placeholder for the sub-command that follows — `` `josh epic:` `` stands for
// `epic:audit`, `epic:next` and the rest — so it names no command of its own.
function command_references(text: string): Array<string> {
	return matches(text, COMMAND_PATTERN)
		.map((match) => match[1] ?? '')
		.filter((name) => !name.endsWith(':'))
}

// A `<placeholder>` inside a command, and `depth:<n>` after the char class stops at `<`, both leave a
// token that is not a real label. Real labels never end in a colon and never carry angle brackets.
function is_real_label(token: string): boolean {
	return token.length > 0 && !token.endsWith(':') && !token.includes('<')
}

function label_references(text: string): Array<string> {
	return matches(text, LABEL_PATTERN)
		.map((match) => match[1] ?? '')
		.filter((token) => is_real_label(token))
}

function base_name(path: string): string {
	return path.split('/').at(-1) ?? path
}

function is_placeholder_file(name: string): boolean {
	return name.includes('<') || PLACEHOLDER_FILES.has(base_name(name).toLowerCase())
}

interface SectionReference {
	file: string
	heading: string
}

function section_references(text: string): Array<SectionReference> {
	return matches(text, SECTION_PATTERN)
		.map(([, file, heading]) => ({ file: file ?? '', heading: heading ?? '' }))
		.filter((reference) => !is_placeholder_file(reference.file))
}

function link_targets(text: string): Array<string> {
	return matches(text, LINK_PATTERN)
		.map((match) => match[1] ?? '')
		.filter((file) => !is_placeholder_file(file))
}

// A cited heading and the heading it names are compared with backticks dropped and whitespace
// collapsed, because a reference wraps at the column the prose wraps at — sometimes across a
// blockquote `> ` continuation — while the heading it points at is one unbroken line.
function normalize_reference(heading: string): string {
	return heading
		.replaceAll('`', '')
		.split(/\s+/u)
		.filter((word) => word !== '>')
		.join(' ')
}

// The two forms a heading can be cited by: with its leading number (`2b. Delegating…`) and without
// (`Delegating…`), since a document's own numbering is a prefix a reference may or may not carry.
function reference_forms(title: string): Array<string> {
	const normalized = normalize_reference(title)

	return [normalized, normalized.replace(/^\d+[a-z]?\. /u, '')]
}

const document_scan = {
	command_references,
	is_placeholder_file,
	label_references,
	link_targets,
	normalize_reference,
	reference_forms,
	section_references,
}

export type { SectionReference }
export { document_scan }
