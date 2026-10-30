import type { TestPinnedRecord } from '#scripts/lane/lane-ledger'
import { lane_ledger_schema } from '#scripts/lane/lane-ledger-schema'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { Hunk } from './test-pinned-logic'
import type { PinnedBy, RedProbe } from './test-red-logic'

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
	const parsed = lane_ledger_schema.pinned_origin_schema.safeParse(raw)

	return parsed.success ? parsed.data : undefined
}

// The hunks a run did not probe: `held` the cache answered, `rewired` left out as a rewire; and what
// started it, `manual` when unnamed.
interface Skipped {
	held: number
	rewired: number
	origin?: PinnedOrigin | undefined
}

async function record(
	skipped: Skipped,
	probes: ReadonlyArray<ProbeTime>,
	elapsed_ms: number,
): Promise<void> {
	await lane_ledger_write.record_test_pinned({
		issue: lane_paths.issue_here(),
		held: skipped.held,
		rewired: skipped.rewired,
		probes: [...probes],
		elapsed_ms,
		origin: skipped.origin ?? MANUAL_ORIGIN,
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
		issue: lane_paths.issue_here(),
		held: 0,
		probes: [],
		elapsed_ms,
		origin,
		discarded: true,
	})
}

const test_pinned_ledger = { BACKGROUND_ORIGIN, origin_of, record, record_discarded, time_of }

export type { PinnedOrigin, ProbeTime }
export { test_pinned_ledger }
