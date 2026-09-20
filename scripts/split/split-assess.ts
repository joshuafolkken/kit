import { test_declared_logic } from '#scripts/test/test-declared-logic'

// The size half of the split assessment, measured rather than estimated (joshuafolkken/kit#2218).
//
// `split-assessment.md` → "The question" asks two things, and only the second is mechanical: does the
// change **clearly exceed** what one verification gate confirms in one pass, the guide being about 10
// changed files and about 400 changed lines, test files excluded. The first — are there two or more
// separately-mergeable deliverables — stays a judgement, so this answers the size question alone and
// never claims to have decided the split.
//
// **The counting excludes test files, single-sourced from `test_declared_logic.is_test_file`.** The
// "test files excluded" clause in the guide and the `*.test.ts` / `*.e2e.ts` spelling are one fact;
// a second copy here would let the two drift.

type SplitVerdict = 'split' | 'single'

// One file's contribution to the change size: its path, and the lines it added plus the lines it
// removed. A binary file, which `git diff --numstat` prints as `-`, contributes zero changed lines.
interface FileChange {
	path: string
	changed_lines: number
}

interface SizeMeasurement {
	files: number
	lines: number
	verdict: SplitVerdict
}

// The guide from `split-assessment.md`. Strictly greater than: "about 10 changed files" and a change
// that "lands at 11 files is not thereby a split" put the bar above the round number, not at it.
const FILE_GUIDE = 10
const LINE_GUIDE = 400

const SPLIT_VERDICT: SplitVerdict = 'split'
const SINGLE_VERDICT: SplitVerdict = 'single'

const BINARY_MARKER = '-'
const NUMSTAT_FIELDS = 3

// A `-` count (binary file), or a missing field, reads as zero; anything else is coerced to a
// number, and an unparseable field also reads as zero rather than throwing on a row this was not
// meant to size.
function parse_count(field: string | undefined): number {
	if (field === undefined || field === BINARY_MARKER) return 0

	const value = Number(field)

	return Number.isNaN(value) ? 0 : value
}

// One `added\tdeleted\tpath` row into a `FileChange`, or `undefined` for a row that is not one.
function parse_row(row: string): FileChange | undefined {
	const fields = row.split('\t')

	if (fields.length < NUMSTAT_FIELDS) return undefined

	const [added, deleted, ...path_parts] = fields

	return { path: path_parts.join('\t'), changed_lines: parse_count(added) + parse_count(deleted) }
}

// The raw stdout of `git diff --numstat` into the changes it lists.
function parse_numstat(raw: string): Array<FileChange> {
	return raw
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line !== '')
		.map((row) => parse_row(row))
		.filter((change): change is FileChange => change !== undefined)
}

function non_test_changes(changes: ReadonlyArray<FileChange>): Array<FileChange> {
	return changes.filter((change) => !test_declared_logic.is_test_file(change.path))
}

// `split` only when **both** guides are exceeded together — the size condition a split has to clear,
// per `split-assessment.md`'s conservative default. Either one alone leaves the change one Issue.
function verdict_for(files: number, lines: number): SplitVerdict {
	return files > FILE_GUIDE && lines > LINE_GUIDE ? SPLIT_VERDICT : SINGLE_VERDICT
}

function measure(changes: ReadonlyArray<FileChange>): SizeMeasurement {
	const runtime = non_test_changes(changes)
	const lines = runtime.reduce((total, change) => total + change.changed_lines, 0)

	return { files: runtime.length, lines, verdict: verdict_for(runtime.length, lines) }
}

// The size measurement of a raw `git diff --numstat`, the one call the CLI makes.
function assess(raw: string): SizeMeasurement {
	return measure(parse_numstat(raw))
}

const SPLIT_TAIL =
	'both exceed the guide — the size condition for a split is met (separability is a separate judgement)'
const SINGLE_TAIL = 'under the guide on at least one axis — one Issue, however separable'

// The sentence printed on stderr: what was counted, against which guide, and what the verdict does
// and does not mean. Test files are already dropped from the counts, so the reason says so.
function reason(measurement: SizeMeasurement): string {
	const counted = `${String(measurement.files)} changed file(s), ${String(measurement.lines)} changed line(s), tests excluded`
	const guide = `guide ${String(FILE_GUIDE)} files / ${String(LINE_GUIDE)} lines`
	const tail = measurement.verdict === SPLIT_VERDICT ? SPLIT_TAIL : SINGLE_TAIL

	return `${counted} (${guide}) — ${tail}`
}

const split_assess = {
	FILE_GUIDE,
	LINE_GUIDE,
	SPLIT_VERDICT,
	SINGLE_VERDICT,
	assess,
	measure,
	non_test_changes,
	parse_numstat,
	parse_row,
	reason,
	verdict_for,
}

export type { FileChange, SizeMeasurement, SplitVerdict }
export { split_assess }
