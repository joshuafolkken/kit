import { time_format } from './time-format'
import type { PullFile } from './time-pull-files'
import { time_spans, type Span } from './time-spans'

// The edits a run made that never reached its merged diff, and the size of the diff that did
// (joshuafolkken/kit#1387).
//
// The 2026-09-05 hand measurement of run #1379 found `scripts/verification-gate.ts` edited twice and
// absent from the final diff — a mid-implementation change of approach, which is rework by any
// reading. `josh time` read the transcript and it read GitHub, and reconciled neither against the
// other, so that kind of work was invisible to every scope. The same measurement found the run's size
// — 6 files, 254 additions, 40 `Edit`/`Write` calls — equally invisible, which is why `27 minutes`
// could not be compared between two runs: on a large change and on a small one it is the same line.
//
// **Both come out of the one file listing.** `time-pull-files.ts` reads it; what is here is the
// arithmetic and the block.
//
// **The edit counts ride the walk that already exists.** A span carries the `targets` read off its
// input at parse time (`time-bundle-call.ts`), so the paths are already on the spans the report is
// built from — a second traversal of the transcript for them would be the clone `CLAUDE.md` prohibits.
//
// ## What the reconciliation cannot see
//
// **It under-reports** a file rewritten through the shell: `sed -i` edits a file and is not an `Edit`
// call, so a path only ever touched that way is not counted at all. The tool form is what the Issue
// names and what the transcripts are made of; widening the set to every command that might write would
// mean reading shell semantics off a string, which is the guess this pipeline refuses everywhere else.
//
// **It over-reports nothing.** A path is called dropped only where a diff that *was* read fails to
// name it, and only for a file inside the work tree: an edit to a scratchpad or a temporary file can
// never appear in any diff, so it is counted apart rather than reported as work that was thrown away.

const { format_columns, unmeasured_row } = time_format

const SIZE_HEADING = 'Change size:'
const EDIT_HEADING = 'Edited files (never landed first, then by edit count):'
const FILES_LABEL = 'files changed'
const ADDITIONS_LABEL = 'lines added'
const DELETIONS_LABEL = 'lines deleted'
const DROPPED_LABEL = 'edited, never landed'
const OUTSIDE_LABEL = 'edited outside the tree'
const EDITED_LABEL = 'edited files'
const IN_DIFF_SUFFIX = 'in the merged diff'
const DROPPED_SUFFIX = 'never reached the merged diff'
// **Not `not measured`.** The row carries a real edit count that was measured; what is missing is the
// half that would say whether the file landed, and a word covering the whole row would deny the count
// beside it.
const UNKNOWN_SUFFIX = 'not reconciled — the merged diff was not read'
const OUTSIDE_SUFFIX = 'could not have reached any diff'
const NO_EDITS = 'no Edit or Write call to reconcile'

// The tools whose calls are a file edit. **An allow-list, for the reason `time-bundle-call.ts` states
// about its own**: a tool nobody classified must not be counted as an edit merely because nobody
// excluded it. `NotebookEdit` is deliberately absent — it carries no target through the parse, so a
// row for it would name no path.
const EDIT_TOOLS = new Set(['Edit', 'Write'])

const PATH_SEPARATOR = '/'
const NONE = 0
const ONE = 1

// Whether the file the edits named is in the merged diff, in three states rather than two.
// `unknown` is the diff not having been read, which is neither of the answers about the file.
type DiffPresence = 'in' | 'dropped' | 'unknown'

const IN_DIFF: DiffPresence = 'in'
const DROPPED: DiffPresence = 'dropped'
const UNKNOWN: DiffPresence = 'unknown'

// What a read of the merged diff established, in **three** states rather than two.
//
// `absent` is the state a boolean could not express: a session report and an unmerged run have no pull
// request, so there was never a diff to read — and printing four `not measured` rows there asserts a
// measurement was attempted and failed, which is the same laundering in the other direction. It is the
// rule `ci_line` already follows, where a scope with no GitHub half prints no `CI wait` row at all.
type DiffState = 'read' | 'refused' | 'absent'

const DIFF_READ: DiffState = 'read'
const DIFF_REFUSED: DiffState = 'refused'
const DIFF_ABSENT: DiffState = 'absent'

// The merged diff as this block needs it.
//
// **`root` is the work tree the transcript's absolute paths sit under, passed in rather than guessed.**
// A transcript names `/Users/…/kit/scripts/x.ts` and a diff names `scripts/x.ts`, and the only thing
// that relates the two is the repository root — which this command already knows, since it is the very
// directory the transcripts were found by. Learning it from a matching pair instead was tried and is
// wrong: `README.md` in a diff is the tail of `docs/README.md` in a transcript, so one basename
// collision both reports an abandoned file as landed and poisons the root every other row is printed
// through.
interface DiffFacts {
	files: ReadonlyArray<PullFile>
	state: DiffState
	root: string
}

// What a scope with no merged pull request passes — a session report, and a run whose measurement
// failed outright. `absent` is what keeps the whole block off such a report.
const NO_DIFF: DiffFacts = { files: [], state: DIFF_ABSENT, root: '' }

// A directory as a prefix: with the separator, so `…/kit` never matches `…/kit-docs`. **An empty root
// stays empty** — appending the separator to it would produce `/`, which every absolute path starts
// with, and the one state that means "nothing to compare against" would match everything.
//
// Normalized here rather than at the caller so a `DiffFacts` built by hand cannot carry a root the
// comparison silently fails on.
function root_of(cwd: string): string {
	if (cwd === '' || cwd.endsWith(PATH_SEPARATOR)) return cwd

	return `${cwd}${PATH_SEPARATOR}`
}

interface EditedFile {
	path: string
	edit_count: number
	presence: DiffPresence
}

interface DiffSize {
	changed_file_count: number
	additions: number
	deletions: number
}

interface ReworkTotals {
	size: DiffSize
	files: Array<EditedFile>
	dropped_count: number
	// How many edited files sat outside the work tree — a scratchpad script, a temporary file. Counted
	// rather than listed: the count is the rework signal, and the paths are absolute and local to whoever
	// ran the session.
	outside_file_count: number
	// What the diff read established. `read` prints the size rows and the presence column, `refused`
	// withholds both in words, and `absent` withholds the whole block.
	state: DiffState
	// Whether any span was read at all — `time_spans.has_transcript_data`, the one criterion every scope
	// withholds a transcript figure on.
	is_measured: boolean
}

const NO_SIZE: DiffSize = { changed_file_count: NONE, additions: NONE, deletions: NONE }

const NO_REWORK: ReworkTotals = {
	size: NO_SIZE,
	files: [],
	dropped_count: NONE,
	outside_file_count: NONE,
	state: DIFF_ABSENT,
	is_measured: false,
}

// A call, as opposed to the tail of one. A continuation is the remainder of a call whose middle went
// to a delegated unit, and counting it would report an edit the run made once as two.
function is_edit(span: Span): boolean {
	return EDIT_TOOLS.has(span.label) && !span.is_continuation
}

// How many times each path was edited. **Repeatedly editing one file is itself a rework signal**, which
// is why the count survives reconciliation rather than being collapsed into a set of paths.
function edit_counts(spans: ReadonlyArray<Span>): Map<string, number> {
	const counts = new Map<string, number>()
	const edits = spans.filter((span) => is_edit(span))

	for (const edit of edits) {
		for (const target of edit.targets) counts.set(target, (counts.get(target) ?? NONE) + ONE)
	}

	return counts
}

// The path as the diff would spell it, or `undefined` where the edit was made outside the work tree.
// **An unknown root puts every path outside**, which is the honest answer: with nothing to relativize
// against, no path can be compared with a diff, and the `outside` row says how many there were.
function relative_of(path: string, root: string): string | undefined {
	if (root === '' || !path.startsWith(root)) return undefined

	return path.slice(root.length)
}

// What one edited path is compared against, carried as a record so `to_edited` stays inside the
// parameter limit and so the three cannot be handed over inconsistently.
interface DiffFrame {
	paths: ReadonlySet<string>
	root: string
	state: DiffState
}

// **Equality against the diff's own spelling, never a tail test.** Both sides are repository-relative
// by the time this is asked, so anything looser only creates the basename collisions the root exists to
// rule out.
function presence_of(relative: string, frame: DiffFrame): DiffPresence {
	if (frame.state !== DIFF_READ) return UNKNOWN

	return frame.paths.has(relative) ? IN_DIFF : DROPPED
}

function to_edited(entry: readonly [string, number], frame: DiffFrame): EditedFile | undefined {
	const [path, edit_count] = entry
	const relative = relative_of(path, frame.root)

	if (relative === undefined) return undefined

	return { path: relative, edit_count, presence: presence_of(relative, frame) }
}

// The order the rows are printed in, read off this list rather than compared pairwise. **A pairwise
// test over three states is not a total order** — `in` against `unknown` answered the same whichever
// way round it was asked — and a sort given one is implementation-defined.
const PRESENCE_ORDER: ReadonlyArray<DiffPresence> = [DROPPED, IN_DIFF, UNKNOWN]

function rank_of(presence: DiffPresence): number {
	return PRESENCE_ORDER.indexOf(presence)
}

// **Dropped first, then by edit count.** Both are rework signals and only the first is a finding on its
// own, so the ordering survives the display cap: a run with thirty edited files still shows the one that
// never landed. The path breaks ties so two runs of the same work print the same table.
function compare(left: EditedFile, right: EditedFile): number {
	if (left.presence !== right.presence) return rank_of(left.presence) - rank_of(right.presence)
	if (left.edit_count !== right.edit_count) return right.edit_count - left.edit_count

	return left.path.localeCompare(right.path)
}

function size_of(files: ReadonlyArray<PullFile>): DiffSize {
	return {
		changed_file_count: files.length,
		additions: files.reduce((sum, file) => sum + file.additions, NONE),
		deletions: files.reduce((sum, file) => sum + file.deletions, NONE),
	}
}

function build_rework(spans: ReadonlyArray<Span>, diff: DiffFacts): ReworkTotals {
	const frame = {
		paths: new Set(diff.files.map((file) => file.path)),
		root: root_of(diff.root),
		state: diff.state,
	}
	const edited = [...edit_counts(spans)]
	const files = edited
		.map((entry) => to_edited(entry, frame))
		.filter((file): file is EditedFile => file !== undefined)
		.toSorted(compare)

	return {
		size: size_of(diff.files),
		files,
		dropped_count: files.filter((file) => file.presence === DROPPED).length,
		outside_file_count: edited.length - files.length,
		state: diff.state,
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

const SIZE_LABELS = [FILES_LABEL, ADDITIONS_LABEL, DELETIONS_LABEL]

// **The two line counts are printed against their sum rather than against each other**, so a run that
// rewrote 40 lines and one that added 254 are distinguishable at a glance — which is the comparison
// between runs this block exists for.
function size_rows(size: DiffSize): Array<string> {
	const changed = `of ${String(size.additions + size.deletions)} changed line(s)`

	return [
		format_columns(FILES_LABEL, String(size.changed_file_count), IN_DIFF_SUFFIX),
		format_columns(ADDITIONS_LABEL, String(size.additions), changed),
		format_columns(DELETIONS_LABEL, String(size.deletions), changed),
	]
}

// **The headline count needs both halves read**, so it is withheld on either. A transcript nobody read
// has no edits to have dropped, and a diff nobody read cannot say that any edit failed to land — and
// `0` asserts a clean run in both.
function dropped_row(totals: ReworkTotals): string {
	if (!totals.is_measured || totals.state !== DIFF_READ) return unmeasured_row(DROPPED_LABEL)

	const of_edited = `of ${String(totals.files.length)} file(s) edited`

	return format_columns(DROPPED_LABEL, String(totals.dropped_count), of_edited)
}

// **A measured zero is not printed, because zero is the ordinary answer.** Most runs edit nothing
// outside the work tree, and a permanent `0` row would be noise on every report; a run that spent five
// edits on a scratch script is the case the row exists to name.
function outside_row(totals: ReworkTotals): Array<string> {
	if (totals.outside_file_count === NONE) return []

	const count = String(totals.outside_file_count)

	return [format_columns(OUTSIDE_LABEL, count, OUTSIDE_SUFFIX)]
}

function size_lines(totals: ReworkTotals): Array<string> {
	const rows =
		totals.state === DIFF_READ
			? size_rows(totals.size)
			: SIZE_LABELS.map((label) => unmeasured_row(label))

	return ['', SIZE_HEADING, ...rows, dropped_row(totals), ...outside_row(totals)]
}

function edit_suffix(file: EditedFile): string {
	if (file.presence === IN_DIFF) return IN_DIFF_SUFFIX

	return file.presence === DROPPED ? DROPPED_SUFFIX : UNKNOWN_SUFFIX
}

function edit_line(file: EditedFile): string {
	return format_columns(file.path, String(file.edit_count), edit_suffix(file))
}

// **The two withheld cases say different things.** A transcript nobody read is `not measured`; a
// transcript that was read and made no file edit has nothing to reconcile, and says so — the same split,
// in the same shape, the bundling block already prints.
function edit_lines(totals: ReworkTotals): Array<string> {
	const heading = ['', EDIT_HEADING]

	if (!totals.is_measured) return [...heading, unmeasured_row(EDITED_LABEL)]
	if (totals.files.length === NONE) return [...heading, format_columns(EDITED_LABEL, '', NO_EDITS)]

	const shown = totals.files.slice(NONE, time_format.MAX_ROWS).map((file) => edit_line(file))

	return [...heading, ...shown, ...time_format.overflow_line(totals.files.length)]
}

// **A scope with no pull request prints no block at all**, the rule `ci_line` already follows: four
// `not measured` rows on a `--session` report would assert that a diff was looked for and missed, when
// a session has no pull request to have one.
function rework_lines(totals: ReworkTotals): Array<string> {
	if (totals.state === DIFF_ABSENT) return []

	return [...size_lines(totals), ...edit_lines(totals)]
}

const time_rework = {
	SIZE_HEADING,
	EDIT_HEADING,
	FILES_LABEL,
	ADDITIONS_LABEL,
	DELETIONS_LABEL,
	DROPPED_LABEL,
	OUTSIDE_LABEL,
	EDITED_LABEL,
	IN_DIFF_SUFFIX,
	DROPPED_SUFFIX,
	UNKNOWN_SUFFIX,
	OUTSIDE_SUFFIX,
	NO_EDITS,
	IN_DIFF,
	DROPPED,
	UNKNOWN,
	DIFF_READ,
	DIFF_REFUSED,
	DIFF_ABSENT,
	NO_DIFF,
	NO_REWORK,
	root_of,
	build_rework,
	rework_lines,
}

export type { DiffFacts, DiffPresence, DiffSize, DiffState, EditedFile, ReworkTotals }
export { time_rework }
