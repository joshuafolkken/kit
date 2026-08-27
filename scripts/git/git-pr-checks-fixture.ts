import type { PrStateSnapshot, RollupCheck } from './git-pr-checks-parse'

// The snapshot every PR-check evaluator test starts from: GitHub reporting CLEAN, an approving
// review, and both checks passing. It lives here rather than being redeclared per test file because
// three files already needed exactly this builder, and a fourth copy is the clone `CLAUDE.md`
// prohibits. `git-pr-checks-e2e-gate.test.ts` deliberately keeps its own builder instead: it states
// `merge_state_status` on every fixture because that string is the mechanism under test there, and a
// default would hide it.
const CODE_RABBIT = 'CodeRabbit'
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

export { make_pr_snapshot, PASSING_ROLLUP, CODE_RABBIT, SONAR_QUBE }
