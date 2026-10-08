import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp, type FileMapStampAccess } from '#scripts/josh/file-map-stamp'

// The records `josh review:brief` reads, keyed on `PROJECT_ROOT` so a global `josh` never answers for
// another project. Gate stamp: the four checks were green on this exact tree. In-flight marker: a gate
// is running on this tree (it asserts no result); it names its writer by pid and start time, so a
// reissued pid cannot revive it, and a stale one is left for the next gate to overwrite. Round-1
// snapshot: the tree `--round 2` measures the fix delta against.
// The scoped stamps claim less than the gate stamp (changed files, two checks), so they stay separate.
const LINT_RELATED_PREFIX = 'josh-lint-related-stamp-'
const TEST_RELATED_PREFIX = 'josh-test-related-stamp-'

const GATE_PREFIX = 'josh-gate-stamp-'
const IN_FLIGHT_PREFIX = 'josh-gate-running-'
const ROUND_ONE_PREFIX = 'josh-review-round1-'
const BRIEFED_PREFIX = 'josh-review-briefed-'

const gate_stamp: FileMapStampAccess = file_map_stamp.create(GATE_PREFIX, PROJECT_ROOT)
const in_flight_stamp: FileMapStampAccess = file_map_stamp.create(IN_FLIGHT_PREFIX, PROJECT_ROOT)
const round_one_stamp: FileMapStampAccess = file_map_stamp.create(ROUND_ONE_PREFIX, PROJECT_ROOT)
// Retaken on every brief: the round-1 snapshot is not the tree a later review read.
const briefed_stamp: FileMapStampAccess = file_map_stamp.create(BRIEFED_PREFIX, PROJECT_ROOT)
const lint_related_stamp: FileMapStampAccess = file_map_stamp.create(
	LINT_RELATED_PREFIX,
	PROJECT_ROOT,
)
const test_related_stamp: FileMapStampAccess = file_map_stamp.create(
	TEST_RELATED_PREFIX,
	PROJECT_ROOT,
)

// Called only from the end of a merged run: a leftover widens the next delta (safe), while an early
// removal lets round 1 re-snapshot an already-fixed tree (unsafe). Swallowed — the PR already merged.
function clear_round_one(target?: string): void {
	try {
		round_one_stamp.remove(target)
	} catch {
		/* a record left behind widens the next round rather than narrowing it */
	}
}

const review_stamps = {
	briefed_stamp,
	clear_round_one,
	GATE_PREFIX,
	gate_stamp,
	IN_FLIGHT_PREFIX,
	in_flight_stamp,
	lint_related_stamp,
	ROUND_ONE_PREFIX,
	round_one_stamp,
	test_related_stamp,
}

export { review_stamps }
