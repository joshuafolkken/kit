import type { SnapshotObserver } from '#scripts/gh/git-pr-checks'
import type { PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import type { CodeRabbitState } from '#scripts/run/event/run-event-checks'
import { followup_checks_event } from './followup-checks-event'

// How long `followup`'s check waits spent with CodeRabbit still running or rate-limited
// (joshuafolkken/kit#4574). CodeRabbit does not gate the merge, so the wait never names it; without
// this, a followup that sat for half an hour beside a rate-limited CodeRabbit leaves nothing in the
// lane ledger but a long `ci-wait`.
//
// **The time between two polls is the state the earlier poll saw** — the observer sees snapshots, not
// transitions, so the clock is read at each one and the interval since the last is charged to the
// state that held over it. The clock is `performance.now()`'s, monotonic for the reason
// `git-followup-stages.ts` states.

const NO_TIME = 0
const RATE_LIMITED: CodeRabbitState = 'rate-limited'
const WAITING_STATES: ReadonlySet<CodeRabbitState> = new Set(['running', RATE_LIMITED])

interface Poll {
	state: CodeRabbitState
	at_ms: number
}

// Mutable for the reason `StageLog` is: the observer adds to it as the wait polls.
interface CodeRabbitWait {
	wait_ms: number
	rate_limited_ms: number
	last?: Poll
}

function new_wait(): CodeRabbitWait {
	return { wait_ms: NO_TIME, rate_limited_ms: NO_TIME }
}

function charge(wait: CodeRabbitWait, last: Poll, now_ms: number): void {
	const elapsed_ms = now_ms - last.at_ms

	if (WAITING_STATES.has(last.state)) wait.wait_ms += elapsed_ms
	if (last.state === RATE_LIMITED) wait.rate_limited_ms += elapsed_ms
}

function observe(wait: CodeRabbitWait, snapshot: PrStateSnapshot, now_ms: number): void {
	if (wait.last !== undefined) charge(wait, wait.last, now_ms)

	wait.last = { state: followup_checks_event.coderabbit_of(snapshot), at_ms: now_ms }
}

// **Each check wait is timed from its own first poll**: the time between two waits — the comment scans,
// the merge that found the head moved — is not CodeRabbit's, whatever the earlier wait last saw.
function observer_of(wait: CodeRabbitWait): SnapshotObserver {
	delete wait.last

	return async function time_snapshot(snapshot: PrStateSnapshot): Promise<void> {
		observe(wait, snapshot, performance.now())
	}
}

// Both observers on every poll — the board's event line and this timer.
function both(first: SnapshotObserver, second: SnapshotObserver): SnapshotObserver {
	return async function observe_both(snapshot: PrStateSnapshot): Promise<void> {
		await first(snapshot)
		await second(snapshot)
	}
}

async function record_part(stage: string, elapsed_ms: number): Promise<void> {
	if (elapsed_ms > NO_TIME) await lane_ledger_write.record_stage({ stage, elapsed_ms })
}

// **A run that never saw CodeRabbit waiting records nothing**, so a row's run count is how many
// followups CodeRabbit held up, and its median is over those.
async function record(wait: CodeRabbitWait): Promise<void> {
	await record_part(lane_ledger_write.CODERABBIT_WAIT_STAGE, wait.wait_ms)
	await record_part(lane_ledger_write.CODERABBIT_RATE_LIMIT_STAGE, wait.rate_limited_ms)
}

const followup_coderabbit_wait = { both, new_wait, observe, observer_of, record }

export type { CodeRabbitWait }
export { followup_coderabbit_wait }
