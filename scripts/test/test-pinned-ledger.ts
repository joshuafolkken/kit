import { lane_ledger } from '#scripts/lane/lane-ledger'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { Hunk } from './test-pinned-logic'
import type { RedProbe } from './test-red-logic'

// One `test-pinned` ledger row per `josh test:pinned` run that probed (joshuafolkken/kit#5078): how
// many hunks the verdict cache answered, and each probed hunk's test files and wall time, so
// `josh lane:breakdown` can say what a long ship pre-detach spent its probe on.

interface ProbeTime {
	file: string
	tests?: number | undefined
	elapsed_ms: number
}

function time_of(hunk: Hunk, verdict: RedProbe, elapsed_ms: number): ProbeTime {
	return { file: hunk.file, tests: verdict.ran, elapsed_ms }
}

// The lane this run is in, read off its checkout; `undefined` outside a lane.
function issue_here(): number | undefined {
	const lane = lane_paths.lane_issue_of(process.cwd())

	return lane === undefined ? undefined : Number(lane)
}

async function record(
	held: number,
	probes: ReadonlyArray<ProbeTime>,
	elapsed_ms: number,
): Promise<void> {
	await lane_ledger.record_test_pinned({
		issue: issue_here(),
		held,
		probes: [...probes],
		elapsed_ms,
	})
}

const test_pinned_ledger = { record, time_of }

export type { ProbeTime }
export { test_pinned_ledger }
