import { PROJECT_ROOT } from '#scripts/init/init-paths'
import type { TestPinnedRecord } from '#scripts/lane/lane-ledger'
import { lane_ledger_pinned_origin } from '#scripts/lane/lane-ledger-pinned-origin'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { MissReason } from './test-pinned-cache-logic'
import type { Hunk } from './test-pinned-logic'
import type { PinnedBy, RedProbe } from './test-red-logic'

type MissCounts = Partial<Record<MissReason, number>>

// One `test-pinned` ledger row per `josh test:pinned` run that probed (joshuafolkken/kit#5078): how
// many hunks the verdict cache answered, and each probed hunk's test files and wall time, so
// `josh lane:breakdown` can say what a long ship pre-detach spent its probe on.

interface ProbeTime {
	file: string
	tests?: number | undefined
	elapsed_ms: number
	pinned_by?: PinnedBy | undefined
}

function time_of(hunk: Hunk, verdict: RedProbe, elapsed_ms: number): ProbeTime {
	const time: ProbeTime = { file: hunk.file, tests: verdict.ran, elapsed_ms }

	return verdict.pinned_by === undefined ? time : { ...time, pinned_by: verdict.pinned_by }
}

// What started a run (joshuafolkken/kit#5262): `run:review`'s background check, the ship's pre-detach,
// or a `josh test:pinned` typed by hand.
type PinnedOrigin = NonNullable<TestPinnedRecord['origin']>

const MANUAL_ORIGIN: PinnedOrigin = 'manual'
const BACKGROUND_ORIGIN: PinnedOrigin = 'run-review'

// A `--origin` value: none is `manual`, one not named above `undefined`.
function origin_of(raw: string | undefined): PinnedOrigin | undefined {
	if (raw === undefined) return MANUAL_ORIGIN
	const parsed = lane_ledger_pinned_origin.pinned_origin_schema.safeParse(raw)

	return parsed.success ? parsed.data : undefined
}

// The hunks a run did not probe: `held` the cache answered, `rewired` left out as a rewire, `over_cap`
// over the test-file cap; and what started it, `manual` when unnamed. The probed ones split as the
// cache knew them (joshuafolkken/kit#7803): `rechecked` against a few tests, `unregistered` with no
// cached verdict. `misses` counts the probed hunks by why the cache did not hold their verdict
// (joshuafolkken/kit#7806). `launch` is how the run was started and where it stopped
// (joshuafolkken/kit#7809).
interface Skipped {
	held: number
	rechecked?: number
	unregistered?: number
	misses?: MissCounts
	rewired: number
	over_cap?: number
	origin?: PinnedOrigin | undefined
	launch?: PinnedLaunch
}

// `first_unpinned` under `--first-unpinned`, `reasoned` under an `--unpinned-ok` reason, `cut` the
// probes a stop at the first unpinned hunk never started, `tree_hash` the work tree the run read; each
// absent where it does not apply.
type PinnedLaunch = Pick<TestPinnedRecord, 'cut' | 'first_unpinned' | 'reasoned' | 'tree_hash'>

// Each reason the cache missed a hunk (`test_pinned_cache.misses`) with its hunk count; a hunk it held
// counts in none.
function miss_counts(misses: ReadonlyArray<MissReason | undefined>): MissCounts {
	const counts: MissCounts = {}

	for (const miss of misses) {
		if (miss !== undefined) counts[miss] = (counts[miss] ?? 0) + 1
	}

	return counts
}

async function record(
	skipped: Skipped,
	probes: ReadonlyArray<ProbeTime>,
	elapsed_ms: number,
): Promise<void> {
	await lane_ledger_write.record_test_pinned({
		issue: lane_paths.issue_here({ directory: PROJECT_ROOT }),
		held: skipped.held,
		rechecked: skipped.rechecked ?? 0,
		unregistered: skipped.unregistered ?? 0,
		misses: skipped.misses,
		rewired: skipped.rewired,
		over_cap: skipped.over_cap ?? 0,
		probes: [...probes],
		elapsed_ms,
		origin: skipped.origin ?? MANUAL_ORIGIN,
		...skipped.launch,
	})
}

// A background check stopped before its answer writes no row of its own, so its stop writes this one:
// the wall time it ran, and nothing it probed. `origin` is its launcher: `run:review`'s check, or the
// pre-detach's probe of the hunks past its stop (joshuafolkken/kit#5327).
async function record_discarded(
	elapsed_ms: number,
	origin: PinnedOrigin = BACKGROUND_ORIGIN,
): Promise<void> {
	await lane_ledger_write.record_test_pinned({
		issue: lane_paths.issue_here({ directory: PROJECT_ROOT }),
		held: 0,
		probes: [],
		elapsed_ms,
		origin,
		discarded: true,
	})
}

const test_pinned_ledger = {
	BACKGROUND_ORIGIN,
	miss_counts,
	origin_of,
	record,
	record_discarded,
	time_of,
}

export type { MissCounts, PinnedLaunch, PinnedOrigin, ProbeTime, Skipped }
export { test_pinned_ledger }
