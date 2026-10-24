import { test_declared_logic } from './test-declared-logic'
import { related_scope } from './test-related-scope'

// The pure half of `josh test:pinned` (joshuafolkken/kit#4516): read a `git diff -U0` into hunks, put
// one hunk's old lines back into the changed file, and split the hunks at the run's cap. The run itself
// is `test-pinned.ts`; an added file's hunks are its functions (`test-pinned-functions.ts`).

const DEFAULT_MAX_HUNKS = 20
const HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,(?<count>\d+))? @@/u
const FILE_HEADER = '+++ b/'
const SECTION_HEADER = 'diff --git '
const OLD_LINE = '-'
const OLD_FILE_HEADER = '--- '
const NEW_LINE = '+'
const FILE_HEADER_MARK = '+++ '
const LINE_BREAK = '\n'
const GREEN_REASON = 'reverting it left every related test green'
const NO_TEST_REASON = 'no related test ran with it reverted'
const STUB_GREEN_REASON = 'replacing its body with a throw left every related test green'
const STUB_NO_TEST_REASON = 'no related test ran with its body replaced by a throw'
const UNPARSED_REASON = 'an added file, and typescript is not installed to read its functions'
const NO_RUNNER_REASON = 'vitest is not installed to run its related tests'

interface Hunk {
	file: string
	// The first changed line of the working file; for a pure deletion, the line the removed ones sat after.
	new_start: number
	new_count: number
	old_lines: Array<string>
	// The working file's lines the hunk spans (`+` lines; an added file's probe, the function's): a revert
	// never reads them, but an unpinned place's key does (`test-pinned-record.ts`), since two changes of one
	// length share the rest.
	new_lines?: Array<string>
	// Set on an added file's probe (`test-pinned-functions.ts`): the function the old lines put back
	// with its body replaced by a throw.
	function_name?: string
}

interface HunkSplit {
	checked: ReadonlyArray<Hunk>
	unchecked: ReadonlyArray<Hunk>
}

// A reverted hunk nothing went red on: `is_green` when its related tests ran and passed, otherwise none
// ran at all — no related test, or a vitest that stopped before running one.
interface UnpinnedHunk extends Hunk {
	is_green: boolean
}

interface PinnedReport {
	unpinned: ReadonlyArray<UnpinnedHunk>
	unchecked: ReadonlyArray<Hunk>
	// Added files whose functions could not be read, so none of them was probed.
	unparsed: ReadonlyArray<string>
	max_hunks: number
	// False when no Vitest is installed to run a probe, so every hunk is `unchecked` rather than run and
	// read as a `no-test` unpinned one.
	has_runner: boolean
}

interface DiffWalk {
	file: string
	hunks: Array<Hunk>
}

// A test file is never reverted, and only a file vitest can walk an import graph back from has related
// tests to run.
function is_target(file: string): boolean {
	return !test_declared_logic.is_test_file(file) && related_scope.is_relatable(file)
}

// An omitted count is one line (`@@ -3 +3 @@`).
function count_of(group: string | undefined): number {
	return group === undefined ? 1 : Number(group)
}

function hunk_from(file: string, line: string): Hunk | undefined {
	const groups = HEADER.exec(line)?.groups
	if (groups === undefined) return undefined

	return {
		file,
		new_start: Number(groups['start']),
		new_count: count_of(groups['count']),
		old_lines: [],
		new_lines: [],
	}
}

function is_old_line(line: string): boolean {
	return line.startsWith(OLD_LINE) && !line.startsWith(OLD_FILE_HEADER)
}

function is_new_line(line: string): boolean {
	return line.startsWith(NEW_LINE) && !line.startsWith(FILE_HEADER_MARK)
}

function record_line(hunk: Hunk | undefined, line: string): void {
	if (hunk === undefined) return
	if (is_old_line(line)) hunk.old_lines.push(line.slice(OLD_LINE.length))
	else if (is_new_line(line)) hunk.new_lines?.push(line.slice(NEW_LINE.length))
}

// Each file section starts unnamed, so a `+++` line this does not read (a quoted path with a space)
// leaves its hunks on no file rather than on the previous one.
function file_after(file: string, line: string): string {
	if (line.startsWith(FILE_HEADER)) return line.slice(FILE_HEADER.length)

	return line.startsWith(SECTION_HEADER) ? '' : file
}

function step(walk: DiffWalk, line: string): void {
	walk.file = file_after(walk.file, line)
	const hunk = hunk_from(walk.file, line)

	if (hunk === undefined) record_line(walk.hunks.at(-1), line)
	else walk.hunks.push(hunk)
}

// One `-U0` diff into its hunks, in diff order. A revert puts the old lines back over the working file's
// `new_count` lines at `new_start`.
function parse_hunks(diff: string): Array<Hunk> {
	const walk: DiffWalk = { file: '', hunks: [] }

	for (const line of diff.split(LINE_BREAK)) step(walk, line)

	return walk.hunks.filter((hunk) => is_target(hunk.file))
}

// A pure deletion's `new_start` names the line before the gap, so the old lines go in after it.
function start_index(hunk: Hunk): number {
	return hunk.new_count === 0 ? hunk.new_start : hunk.new_start - 1
}

// The working file's content with this one hunk put back to the base's lines.
function revert(content: string, hunk: Hunk): string {
	const lines = content.split(LINE_BREAK)

	lines.splice(start_index(hunk), hunk.new_count, ...hunk.old_lines)

	return lines.join(LINE_BREAK)
}

function split(hunks: ReadonlyArray<Hunk>, max_hunks: number): HunkSplit {
	return { checked: hunks.slice(0, max_hunks), unchecked: hunks.slice(max_hunks) }
}

function location(hunk: Hunk): string {
	const line = `${hunk.file}:${String(Math.max(hunk.new_start, 1))}`

	return hunk.function_name === undefined ? line : `${line} ${hunk.function_name}`
}

function reason(hunk: UnpinnedHunk): string {
	if (hunk.function_name === undefined) return hunk.is_green ? GREEN_REASON : NO_TEST_REASON

	return hunk.is_green ? STUB_GREEN_REASON : STUB_NO_TEST_REASON
}

function unchecked_reason(report: PinnedReport): string {
	return report.has_runner ? `over the ${String(report.max_hunks)}-hunk cap` : NO_RUNNER_REASON
}

function format(report: PinnedReport): string {
	const unpinned = report.unpinned.map((hunk) => `unpinned ${location(hunk)} — ${reason(hunk)}`)
	const unchecked = report.unchecked.map(
		(hunk) => `unchecked ${location(hunk)} — ${unchecked_reason(report)}`,
	)
	const unparsed = report.unparsed.map((file) => `unchecked ${file} — ${UNPARSED_REASON}`)

	return [...unpinned, ...unchecked, ...unparsed].join(LINE_BREAK)
}

// The counts line, then one line per unpinned or unchecked place — what `josh test:pinned` prints and
// what `josh run:review` prints before round 1.
function report_text(report: PinnedReport): string {
	const unpinned = String(report.unpinned.length)
	const unchecked = String(report.unchecked.length + report.unparsed.length)
	const lines = [`unpinned ${unpinned} · unchecked ${unchecked}`, format(report)]

	return `${lines.filter((line) => line !== '').join(LINE_BREAK)}${LINE_BREAK}`
}

const test_pinned_logic = {
	DEFAULT_MAX_HUNKS,
	format,
	is_target,
	location,
	parse_hunks,
	report_text,
	revert,
	split,
}

export type { Hunk, PinnedReport, UnpinnedHunk }
export { test_pinned_logic }
