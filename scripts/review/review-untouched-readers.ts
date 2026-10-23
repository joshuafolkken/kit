import { readFileSync } from 'node:fs'
import path from 'node:path'
import { git_grep_hits, type Hit } from '#scripts/git/git-grep-hits'
import { git_spawn } from '#scripts/git/git-spawn'
import { review_readers_scan, type Edited } from './review-readers-scan'

// The readers outside the diff of each exported name the diff edits, listed in the brief
// (joshuafolkken/kit#4515). A reader the change left on the old meaning was the most common kind of
// finding that stopped a lane review; the self-check's "Every caller moved with it" asked for the
// search and left it to the implementer, and this does it mechanically for the reviewer to read.
//
// **A reader is a line outside the changed paths that names the edited name as a word** — a
// re-derivation or an alias is not found, and the list says so. A grep that could not run is printed
// as such, never as "no readers".

const SOURCE_FILE = /\.(?:ts|js)$/u
const SEARCH_PATHS = ['*.ts', '*.js', '*.svelte', ':(exclude)*.snap']
const WORD_FLAG = '-w'
const MAX_HITS = 10
const MAX_NAMES = 30
const HEADING = '## Readers outside the diff'
const ROLE_LINE =
	'Each exported name this change edits, with every line outside the changed paths that names it (`git grep -w`). Check each reader still holds under the new meaning — the self-check\'s "Every caller moved with it" (`prompts/review.md`). A reader left on the old meaning is a finding at the reader\'s `file:line`. A reader reaching the name through an alias or a re-derivation is not listed.'
const SEARCH_FAILED = '  - git grep failed; not searched'
const READ_FAILED = 'The readers outside the diff could not be read; search them yourself:'
const OMITTED_TAIL = 'not searched; search their readers yourself'

interface Readers {
	target: string
	origin: string
	hits: ReadonlyArray<Hit>
	has_failed: boolean
}

// `omitted` counts the edited names past `MAX_NAMES`, which were never searched.
interface ReadersRead {
	readers: ReadonlyArray<Readers>
	omitted: number
	has_failed: boolean
}

const NO_READ: ReadersRead = { readers: [], omitted: 0, has_failed: false }
const FAILED_READ: ReadersRead = { readers: [], omitted: 0, has_failed: true }

interface ReadRequest {
	root: string
	base: string
	paths: ReadonlyArray<string>
}

interface FileEdits {
	relative: string
	edits: ReadonlyArray<Edited>
}

async function file_edits(request: ReadRequest, relative: string): Promise<FileEdits> {
	const { root, base } = request
	const diff = await git_spawn.read(['-C', root, 'diff', '-U0', '--no-color', base, '--', relative])

	if (diff.length === 0) return { relative, edits: [] }

	// A path the change deletes has no text; its readers fail the typecheck rather than read stale.
	try {
		const source = readFileSync(path.join(root, relative), 'utf8')

		return { relative, edits: review_readers_scan.edited(source, diff) }
	} catch {
		return { relative, edits: [] }
	}
}

function excluded(paths: ReadonlyArray<string>): Array<string> {
	return paths.map((relative) => `:(exclude,literal)${relative}`)
}

async function readers_of(request: ReadRequest, entry: FileEdits, edit: Edited): Promise<Readers> {
	const pathspecs = [...SEARCH_PATHS, ...excluded(request.paths)]
	const found = await git_grep_hits.search(edit.target, [WORD_FLAG], pathspecs, request.root)

	return { target: edit.target, origin: `${entry.relative}:${String(edit.line)}`, ...found }
}

// Every edited name, with its readers outside `paths`. Only names that have a reader, or whose search
// failed, are returned; the names past the cap are counted, never dropped silently.
async function read(request: ReadRequest): Promise<ReadersRead> {
	const sources = request.paths.filter((relative) => SOURCE_FILE.test(relative))
	const files = await Promise.all(
		sources.map(async (relative) => await file_edits(request, relative)),
	)
	const pairs = files.flatMap((entry) => entry.edits.map((edit) => ({ entry, edit })))
	const capped = pairs.slice(0, MAX_NAMES)
	const all = await Promise.all(
		capped.map(async ({ entry, edit }) => await readers_of(request, entry, edit)),
	)

	const readers = all.filter((entry) => entry.has_failed || entry.hits.length > 0)

	return { readers, omitted: pairs.length - capped.length, has_failed: false }
}

function hit_line(hit: Hit): string {
	return `  - ${hit.path}:${hit.line}  ${hit.excerpt}`
}

function readers_lines(readers: Readers): Array<string> {
	const head = `- \`${readers.target}\` — ${readers.origin}`

	if (readers.has_failed) return [head, SEARCH_FAILED]

	const more = readers.hits.length - MAX_HITS
	const tail = more > 0 ? [`  - … and ${String(more)} more`] : []

	return [head, ...readers.hits.slice(0, MAX_HITS).map((hit) => hit_line(hit)), ...tail]
}

function omitted_lines(omitted: number): Array<string> {
	if (omitted === 0) return []

	return [`- … and ${String(omitted)} more edited names ${OMITTED_TAIL}`]
}

// A read that failed as a whole says so, never reads as a change with no reader outside it; absent
// or empty, no section.
function brief_block(read_result: ReadersRead = NO_READ): ReadonlyArray<string> {
	const { readers, omitted, has_failed } = read_result

	if (has_failed) return ['', `${HEADING}\n${READ_FAILED}`]
	if (omitted === 0 && readers.length === 0) return []

	const listed = readers.flatMap((entry) => readers_lines(entry))

	return ['', [HEADING, ROLE_LINE, ...listed, ...omitted_lines(omitted)].join('\n')]
}

const review_untouched_readers = {
	brief_block,
	FAILED_READ,
	HEADING,
	MAX_NAMES,
	OMITTED_TAIL,
	read,
	READ_FAILED,
}

export type { Readers, ReadersRead }
export { review_untouched_readers }
