import { existsSync, readFileSync, statSync } from 'node:fs'
import { gate_labels } from '#scripts/gate/gate-labels'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { moved_paths, type MovedParts } from '#scripts/gate/moved-paths'
import { scoped_green } from '#scripts/gate/scoped-green'
import { since_green } from '#scripts/gate/since-green'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import type { RunInput } from './test-related-record'
import { related_scope, type RelatedScope } from './test-related-scope'
import { vitest_failure_summary } from './vitest-failure-summary'

// **A red `josh test:related` records what it vouches for, so the re-run after a fix need not repeat
// it** (joshuafolkken/kit#5386). A bare run that ended red in vitest itself had every test it reached
// green except the files it lists as failed, and a test it did not reach was vouched for by the green
// it narrowed from. So on the same base and inputs, the failed files plus what moved since this record
// are everything still unproven: green there is green over the full reach, and the green record the
// gate and the review reuse follows from it as from any bare run.
//
// **Anything the record cannot vouch for falls back to the reading without it**: a base or inputs that
// moved (a main merge), a failure with no file named (a crash, a config error), a first pass that was
// green, or a no-base pass that never ran — whose own files are carried as owed, so the narrowed run's
// no-base pass still covers them.

const FAILED_MARK = 'failed'
const OWED_MARK = 'no-base'

// A green record's reading is the same shape with no failed or owed file.
interface RedReading {
	parts: MovedParts
	moved: ReadonlyArray<string>
	failed: ReadonlyArray<string>
	owed: ReadonlyArray<string>
}

// `owed`: the files a red run's no-base pass never read, carried by its record.
interface RelatedInput extends RunInput {
	owed: ReadonlyArray<string>
}

// `before` is `undefined` when the run could vouch for no tree — arguments narrowed it, or vitest never
// ran — and the record is then left as it is.
interface RedRun {
	before: GateTree | undefined
	scope: RelatedScope
	first_exit: number
	started_ms: number
	owed: ReadonlyArray<string>
}

function marked(blobs: Record<string, string>, mark: string): Array<string> {
	return Object.entries(blobs)
		.filter(([, value]) => value === mark)
		.map(([file]) => file)
}

function reading_of(
	parts: MovedParts | undefined,
	marks: Pick<RedReading, 'failed' | 'owed'>,
): RedReading | undefined {
	return parts === undefined ? undefined : { parts, moved: moved_paths.union_of(parts), ...marks }
}

// Read against the tree the run starts on, and only by a run that could record — the one whose green
// vouches for the full reach. The base must be the record's own: a main merge since moves files no
// test of this branch was read for, and the run falls back to the reading without the record.
function marks_on(before: GateTree): Record<string, string> {
	const record = review_stamps.test_related_red_stamp.read()

	if (record === undefined || !file_map_stamp.describes_base(record, before.base)) return {}

	return record.blobs ?? {}
}

async function read_red(before: GateTree | undefined): Promise<RedReading | undefined> {
	if (before === undefined) return undefined

	const blobs = marks_on(before)
	const failed = marked(blobs, FAILED_MARK)

	if (failed.length === 0) return undefined

	const stamp = review_stamps.test_related_red_stamp
	const parts = await since_green.read_moved_parts(stamp, gate_labels.UNIT_LABEL, undefined, before)

	return reading_of(parts, { failed, owed: marked(blobs, OWED_MARK) })
}

// **A red record, where one stands, narrows before the green one**: it is the later of the two, and
// its failed files join what moved since it.
async function narrowing(red: RedReading | undefined): Promise<RedReading | undefined> {
	if (red !== undefined) return red

	const parts = await since_green.read_moved_parts(
		review_stamps.test_related_stamp,
		gate_labels.UNIT_LABEL,
	)

	return reading_of(parts, { failed: [], owed: [] })
}

// The unit log the first pass wrote, read only when this run wrote it: an older one names files
// another run failed.
function failed_of(scope: RelatedScope, started_ms: number): ReadonlyArray<string> {
	const log = vitest_failure_summary.unit_log_path(related_scope.vitest_arguments(scope))

	if (!existsSync(log) || statSync(log).mtimeMs < started_ms) return []

	const { failed_files, failed_tests } = vitest_failure_summary

	return failed_files(failed_tests(readFileSync(log, 'utf8')))
}

function blobs_of(
	failed: ReadonlyArray<string>,
	owed: ReadonlyArray<string>,
): Record<string, string> {
	const entries: Array<[string, string]> = [
		...owed.map((file): [string, string] => [file, OWED_MARK]),
		...failed.map((file): [string, string] => [file, FAILED_MARK]),
	]

	return Object.fromEntries(entries)
}

function clear(): void {
	try {
		review_stamps.test_related_red_stamp.remove()
	} catch {
		/* a record left behind is refused on its base, inputs or tree, never trusted blindly */
	}
}

function write(before: GateTree, failed: ReadonlyArray<string>, owed: ReadonlyArray<string>): void {
	try {
		review_stamps.test_related_red_stamp.write(
			before.files,
			undefined,
			before.base,
			blobs_of(failed, owed),
		)
	} catch {
		clear()
	}
}

// Only a red first pass names failed files; a green one, or a red no-base pass, leaves nothing to vouch for.
function failed_in(run: RedRun): ReadonlyArray<string> {
	return run.first_exit === 0 ? [] : failed_of(run.scope, run.started_ms)
}

async function record_red(run: RedRun): Promise<void> {
	const { before } = run

	if (before === undefined) return

	const failed = failed_in(run)
	const is_vouched =
		failed.length > 0 && scoped_green.is_unmoved(before, await gate_tree.read_gate_tree())

	if (is_vouched) write(before, failed, run.owed)
	else clear()
}

// The no-base pass reads this branch's own files — those the map's tree or a main sync joined were
// verified by main's CI — and those a red run before this one never reached it with.
function no_base_files(input: RelatedInput): ReadonlyArray<string> {
	const joined = new Set([...input.since_map, ...input.synced])
	const own = (input.changed ?? []).filter((file) => !joined.has(file))

	return [...new Set([...own, ...input.owed])]
}

function describe(reading: RedReading): string {
	const { failed, moved } = reading
	const label = related_scope.COMMAND_LABEL

	if (failed.length === 0) return since_green.describe(label, moved)

	return (
		`${label}: reading only the ${String(failed.length)} test file(s) that failed in its last run ` +
		`and the ${String(moved.length)} file(s) changed since.`
	)
}

const test_related_red = { describe, narrowing, no_base_files, read_red, record_red }

export type { RedReading, RedRun, RelatedInput }
export { test_related_red }
