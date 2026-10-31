import { verification_tail, type KeptLog } from '#scripts/gate/verification-tail'
import { test_declared_logic } from './test-declared-logic'
import { test_pinned_stage, type Staged } from './test-pinned-stage'
import type { RedProbe, RedVerdict } from './test-red-logic'
import { related_scope } from './test-related-scope'

// The pure half of `josh test:pinned` (joshuafolkken/kit#4516): read a `git diff -U0` into hunks, put
// one hunk's old lines back into the changed file, and split the hunks at the run's cap. The run itself
// is `test-pinned.ts`; an added file's hunks are its functions (`test-pinned-functions.ts`).

const DEFAULT_MAX_HUNKS = 20
// The most test files one hunk's probe runs (joshuafolkken/kit#5503): past it a hub's one-line change
// runs hundreds to prove it green, so the hunk is `unchecked`. 150 sits just over the ledger's p90
// and above `WIDE_REACH`, so the staged range stays probed.
const MAX_TEST_FILES = 150
const HEADER = /^@@ -\d+(?:,\d+)? \+(?<start>\d+)(?:,(?<count>\d+))? @@/u
const FILE_HEADER = '+++ b/'
const SECTION_HEADER = 'diff --git '
const OLD_LINE = '-'
const OLD_FILE_HEADER = '--- '
const NEW_LINE = '+'
const FILE_HEADER_MARK = '+++ '
const OLD_FILE_PATH = '--- a/'
const LINE_BREAK = '\n'
const GREEN_REASON = 'reverting it left every related test green'
const NO_TEST_REASON = 'no related test ran with it reverted'
const STUB_GREEN_REASON = 'replacing its body with a throw left every related test green'
const STUB_NO_TEST_REASON = 'no related test ran with its body replaced by a throw'
const UNPARSED_REASON = 'an added file, and typescript is not installed to read its functions'
const NO_RUNNER_REASON = 'vitest is not installed to run its related tests'
const STOPPED_REASON = 'vitest stopped before any test ran with it reverted'
const CUT_REASON = 'not probed: the run stopped at the first unpinned hunk'
const OVER_CAP_REASON = `over the ${String(MAX_TEST_FILES)}-test-file cap`
const STOPPED_VERDICT: RedVerdict = 'stopped'
const SETTLED_VERDICTS: ReadonlySet<RedVerdict> = new Set<RedVerdict>(['red', STOPPED_VERDICT])

interface Hunk {
	file: string
	// A move's disjoint deletion/addition; intervening hunks stay independent.
	parts?: ReadonlyArray<Hunk>
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

// A reverted hunk nothing went red on: `is_green` when its related tests ran and passed, otherwise
// vitest passed with no related test to run.
interface UnpinnedHunk extends Hunk {
	is_green: boolean
}

interface HunkOutcome {
	unpinned: ReadonlyArray<UnpinnedHunk>
	// Hunks whose revert stopped vitest before any test ran (joshuafolkken/kit#5043) — a config that
	// imports the file could not load. No test was asked, so it is neither pinned nor unpinned.
	stopped: ReadonlyArray<Hunk>
	// Hunks a `--first-unpinned` run did not probe once one was unpinned (joshuafolkken/kit#5153): the
	// run fails already, so the rest wait for the next run.
	cut?: ReadonlyArray<Hunk>
	// Hunks whose file reaches more than `MAX_TEST_FILES` test files, never probed (joshuafolkken/kit#5503).
	over_cap?: ReadonlyArray<Hunk>
	// Whether every checked hunk had a verdict — false when a cache-only read found one the cache no
	// longer holds (joshuafolkken/kit#5078).
	is_held?: boolean
	// How many fresh probes the direct importers decided or escalated (joshuafolkken/kit#5292).
	staged?: Staged
}

interface PinnedReport extends HunkOutcome {
	unchecked: ReadonlyArray<Hunk>
	// Added files whose functions could not be read, so none of them was probed.
	unparsed: ReadonlyArray<string>
	max_hunks: number
	// False when no Vitest is installed to run a probe, so every hunk is `unchecked` rather than run and
	// read as a `no-test` unpinned one.
	has_runner: boolean
}

interface UncheckedPlace {
	place: string
	why: string
}

// A report as printed (joshuafolkken/kit#5188): `text` is its lines above the counts line, each ending in
// a newline; `counts` is absent for a check that could not run, and `log` where no full list was kept.
interface ReportParts {
	text: string
	counts?: string | undefined
	log?: KeptLog | undefined
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
// leaves its hunks on no file rather than on the previous one. A deleted file (`+++ /dev/null`) keeps
// the name its `--- a/` line gave it.
function file_after(file: string, line: string): string {
	if (line.startsWith(FILE_HEADER)) return line.slice(FILE_HEADER.length)
	if (line.startsWith(OLD_FILE_PATH)) return line.slice(OLD_FILE_PATH.length)

	return line.startsWith(SECTION_HEADER) ? '' : file
}

function step(walk: DiffWalk, line: string): void {
	walk.file = file_after(walk.file, line)
	const hunk = hunk_from(walk.file, line)

	if (hunk === undefined) record_line(walk.hunks.at(-1), line)
	else walk.hunks.push(hunk)
}

// One `-U0` diff (`a/` and `b/` prefixes) into every file's hunks, in diff order — also read by
// `prose-stale-cli.ts` for the lines a diff removed and added.
function all_hunks(diff: string): Array<Hunk> {
	const walk: DiffWalk = { file: '', hunks: [] }

	for (const line of diff.split(LINE_BREAK)) step(walk, line)

	return walk.hunks
}

// The hunks a revert probes. A revert puts the old lines back over the working file's `new_count` lines
// at `new_start`.
function parse_hunks(diff: string): Array<Hunk> {
	return all_hunks(diff).filter((hunk) => is_target(hunk.file))
}

// A pure deletion's `new_start` names the line before the gap, so the old lines go in after it.
function start_index(hunk: Hunk): number {
	return hunk.new_count === 0 ? hunk.new_start : hunk.new_start - 1
}

// The working file's content with this one hunk put back to the base's lines.
function revert(content: string, hunk: Hunk): string {
	const lines = content.split(LINE_BREAK)
	const parts = (hunk.parts ?? [hunk]).toSorted(
		(left, right) => start_index(right) - start_index(left),
	)

	for (const part of parts) lines.splice(start_index(part), part.new_count, ...part.old_lines)

	return lines.join(LINE_BREAK)
}

function split(hunks: ReadonlyArray<Hunk>, max_hunks: number): HunkSplit {
	return { checked: hunks.slice(0, max_hunks), unchecked: hunks.slice(max_hunks) }
}

// The hunks split at the per-hunk test-file cap, each keeping its order; a file `reach` lacks counts as
// 0, so it is checked.
function capped(
	hunks: ReadonlyArray<Hunk>,
	reach: ReadonlyMap<string, number>,
	max_tests = MAX_TEST_FILES,
): HunkSplit {
	function is_over(hunk: Hunk): boolean {
		return (reach.get(hunk.file) ?? 0) > max_tests
	}

	return {
		checked: hunks.filter((hunk) => !is_over(hunk)),
		unchecked: hunks.filter((hunk) => is_over(hunk)),
	}
}

// The probes, the ones whose file reaches the fewest tests first (joshuafolkken/kit#5153), so a run
// that stops at its first unpinned hunk reaches it soonest; a file `reach` lacks counts as 0, and
// equal counts keep their order.
function by_reach<T extends { hunk: Hunk }>(
	probes: ReadonlyArray<T>,
	reach: ReadonlyMap<string, number>,
): Array<T> {
	function count(probe: T): number {
		return reach.get(probe.hunk.file) ?? 0
	}

	return probes.toSorted((first, second) => count(first) - count(second))
}

// `green` and `no-test` leave a hunk unpinned: either way nothing went red when it was reverted.
function is_unpinned(probe: RedProbe): boolean {
	return !SETTLED_VERDICTS.has(probe.verdict)
}

// A hunk with no verdict yet is neither pinned nor unpinned.
function unpinned_of(hunk: Hunk, probe: RedProbe | undefined): Array<UnpinnedHunk> {
	if (probe === undefined || !is_unpinned(probe)) return []

	return [{ ...hunk, is_green: probe.verdict === 'green' }]
}

function stopped_of(hunk: Hunk, probe: RedProbe | undefined): Array<Hunk> {
	return probe?.verdict === STOPPED_VERDICT ? [hunk] : []
}

// Each checked hunk by its verdict, in the hunks' order: `red` pins it, `stopped` sets it aside, and
// any other leaves it unpinned.
function outcome(
	hunks: ReadonlyArray<Hunk>,
	verdicts: ReadonlyArray<RedProbe | undefined>,
): HunkOutcome {
	return {
		unpinned: hunks.flatMap((hunk, index) => unpinned_of(hunk, verdicts[index])),
		stopped: hunks.flatMap((hunk, index) => stopped_of(hunk, verdicts[index])),
	}
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

function unpinned_lines(report: PinnedReport): Array<string> {
	return report.unpinned.map((hunk) => `unpinned ${location(hunk)} — ${reason(hunk)}`)
}

function place_of(hunk: Hunk, why: string): UncheckedPlace {
	return { place: location(hunk), why }
}

// Every unchecked place with its reason, in the full list's order.
function unchecked_places(report: PinnedReport): Array<UncheckedPlace> {
	return [
		...report.unchecked.map((hunk) => place_of(hunk, unchecked_reason(report))),
		...(report.over_cap ?? []).map((hunk) => place_of(hunk, OVER_CAP_REASON)),
		...report.stopped.map((hunk) => place_of(hunk, STOPPED_REASON)),
		...(report.cut ?? []).map((hunk) => place_of(hunk, CUT_REASON)),
		...report.unparsed.map((file) => ({ place: file, why: UNPARSED_REASON })),
	]
}

// Whether the printed report folds any place, so the full list is worth keeping.
function has_unchecked(report: PinnedReport): boolean {
	return unchecked_places(report).length > 0
}

// One line per unpinned or unchecked place — the full list `josh test:pinned` keeps in its log.
function format(report: PinnedReport): string {
	const unchecked = unchecked_places(report).map((item) => `unchecked ${item.place} — ${item.why}`)

	return [...unpinned_lines(report), ...unchecked].join(LINE_BREAK)
}

// The unchecked places folded to one line per reason (joshuafolkken/kit#5188): a cap's overflow listed
// one line each pushed the unpinned places, and what to do about them, out of a `tail` window.
function folded_unchecked(report: PinnedReport): Array<string> {
	const counts = new Map<string, number>()

	for (const { why } of unchecked_places(report)) counts.set(why, (counts.get(why) ?? 0) + 1)

	return [...counts].map(([why, count]) => `unchecked ${String(count)} — ${why}`)
}

function counts_line(report: PinnedReport): string {
	const unchecked = String(unchecked_places(report).length)

	const staged = test_pinned_stage.counts_suffix(report.staged)

	return `unpinned ${String(report.unpinned.length)} · unchecked ${unchecked}${staged}`
}

// The report's parts: each unpinned place and the folded unchecked lines, and the counts line.
function report_parts(report: PinnedReport): ReportParts {
	const lines = [...unpinned_lines(report), ...folded_unchecked(report)]

	return { text: lines.map((line) => `${line}${LINE_BREAK}`).join(''), counts: counts_line(report) }
}

// What `josh test:pinned`, `josh run:review` and the ship's pre-detach print, in the verification-tail
// shape (`verification-tail.ts`): the places, then `note` (what to do about them, each line ending in a
// newline), then where the full list went, and the counts line last. Without a counts line — a check
// that could not run — the text and the note alone.
function report_text(parts: ReportParts, note = ''): string {
	const failures = `${parts.text}${note}`
	if (parts.counts === undefined) return failures

	return verification_tail.format_tail({ failures, log: parts.log, verdict: parts.counts })
}

const test_pinned_logic = {
	all_hunks,
	DEFAULT_MAX_HUNKS,
	by_reach,
	capped,
	format,
	has_unchecked,
	is_target,
	is_unpinned,
	location,
	MAX_TEST_FILES,
	outcome,
	parse_hunks,
	report_parts,
	report_text,
	revert,
	split,
}

export type { Hunk, HunkOutcome, PinnedReport, ReportParts, UnpinnedHunk }
export { test_pinned_logic }
