import type { SnapshotObserver } from '#scripts/gh/git-pr-checks'
import { is_coderabbit_check } from '#scripts/gh/git-pr-checks-eval'
import { CHECK_STATUS_PENDING, type PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'

// Which check `followup`'s CI wait waited on last (joshuafolkken/kit#5295). The `ci-wait` row alone
// says how long the wait was, not which job held it, so the next job to shorten could not be chosen.
//
// **A check is timed when it is seen pending and then settled**: its time is the interval from the
// wait's first poll to the first poll that saw it settled. A check already settled at the first poll
// held nothing up and is not recorded. CodeRabbit is left out — its wait is `coderabbit-wait`'s
// (`followup-coderabbit-wait.ts`), so it is never counted twice. The clock is `performance.now()`'s
// for the reason `git-followup-stages.ts` states.

// Mutable for the reason `StageLog` is: the observer adds to it as the wait polls.
interface CiPath {
	start_ms?: number
	pending: Set<string>
	check_ms: Record<string, number>
}

// The `ci-wait` row's critical-path fields, both absent where no check was seen to settle.
interface CiPathRecord {
	last_check?: string
	check_ms?: Record<string, number>
}

function new_path(): CiPath {
	return { pending: new Set(), check_ms: {} }
}

function settle(path: CiPath, name: string, elapsed_ms: number): void {
	if (path.pending.delete(name)) path.check_ms[name] = elapsed_ms
}

function observe(path: CiPath, snapshot: PrStateSnapshot, now_ms: number): void {
	path.start_ms ??= now_ms
	const elapsed_ms = now_ms - path.start_ms
	const checks = snapshot.rollup.filter((check) => !is_coderabbit_check(check.name))

	for (const check of checks) {
		if (check.status === CHECK_STATUS_PENDING) path.pending.add(check.name)
		else settle(path, check.name, elapsed_ms)
	}
}

// **Only the first check wait is timed**: the `ci-wait` row is that wait's lap, and the wait the merge
// goes back to when the head moved (#4036) times checks the row does not cover.
function observer_of(path: CiPath): SnapshotObserver {
	const is_first_wait = path.start_ms === undefined

	return async function time_checks(snapshot: PrStateSnapshot): Promise<void> {
		if (is_first_wait) observe(path, snapshot, performance.now())
	}
}

function record_of(path: CiPath): CiPathRecord {
	const [last] = Object.entries(path.check_ms).toSorted((left, right) => right[1] - left[1])

	if (last === undefined) return {}

	return { last_check: last[0], check_ms: { ...path.check_ms } }
}

const followup_ci_path = { new_path, observe, observer_of, record_of }

export type { CiPath, CiPathRecord }
export { followup_ci_path }
