import { CODERABBIT_CHECK_NAME } from './git-pr-checks-eval'
import type { PrStateSnapshot, RollupCheck } from './git-pr-checks-parse'

// The snapshot every PR-check evaluator test starts from: GitHub reporting CLEAN, an approving
// review, and both checks passing. It lives here rather than being redeclared per test file because
// three files already needed exactly this builder, and a fourth copy is the clone `CLAUDE.md`
// prohibits. `git-pr-checks-e2e-gate.test.ts` deliberately keeps its own builder instead: it states
// `merge_state_status` on every fixture because that string is the mechanism under test there, and a
// default would hide it.
// Read from the production constant rather than respelled: a fixture that hard-codes the name keeps
// passing after the name changes, which is the one way these tests could go green over an exemption
// that no longer matches anything (joshuafolkken/kit#1217).
const CODE_RABBIT = CODERABBIT_CHECK_NAME
const SONAR_QUBE = 'SonarQube'
const MERGE_STATE_CLEAN = 'CLEAN'
const REVIEW_APPROVED = 'APPROVED'

const PASSING_ROLLUP: ReadonlyArray<RollupCheck> = [
	{ name: CODE_RABBIT, status: 'pass' },
	{ name: SONAR_QUBE, status: 'pass' },
]

function make_pr_snapshot(overrides: Partial<PrStateSnapshot> = {}): PrStateSnapshot {
	return {
		rollup: [...PASSING_ROLLUP],
		merge_state_status: MERGE_STATE_CLEAN,
		review_decision: REVIEW_APPROVED,
		...overrides,
	}
}

const NO_SNAPSHOT_ERROR = 'No snapshot available for test.'

// A snapshot GitHub has not settled yet: the aggregate is UNKNOWN and no checks have reported. The
// poll loop reads it as `pending` — neither success nor failure — so a test can script a run that is
// still in flight before it lands.
function pending_rollup_snapshot(): PrStateSnapshot {
	return make_pr_snapshot({ merge_state_status: 'UNKNOWN', rollup: [] })
}

// Steps through the given snapshots one per poll and reports how many reads were taken, so a test can
// drive `wait_for_pr_success` through a scripted sequence of poll results. Shared rather than
// re-declared per suite: a second copy is the clone `CLAUDE.md` prohibits (joshuafolkken/kit#2029).
function make_sequence_fetcher(snapshots: ReadonlyArray<PrStateSnapshot>): {
	count: () => number
	fetch: () => Promise<PrStateSnapshot>
} {
	let index = 0

	async function fetch(): Promise<PrStateSnapshot> {
		const snapshot = snapshots[index] ?? snapshots.at(-1)

		index += 1

		if (snapshot === undefined) throw new Error(NO_SNAPSHOT_ERROR)

		return snapshot
	}

	function count(): number {
		return index
	}

	return { count, fetch }
}

export {
	make_pr_snapshot,
	make_sequence_fetcher,
	pending_rollup_snapshot,
	PASSING_ROLLUP,
	CODE_RABBIT,
	SONAR_QUBE,
}
