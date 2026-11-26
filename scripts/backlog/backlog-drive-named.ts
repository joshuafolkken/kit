import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_token } from '#scripts/run/merge/run-merge-token'
import { run_invocation } from '#scripts/run/run-invocation'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_hold_codes } from './backlog-hold-codes'

const { MERGE_TOKEN } = run_merge_token
const { ONLY_WAIT } = backlog_hold_codes

const NO_RETRIES = 0
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set([
	'merged',
	'parked',
	'human-review',
	'split',
	'withdrawn',
])

// **The named issues run side by side** (joshuafolkken/kit#8953): every one left that is not in flight
// is offered at once, in the order typed, which is only the order free lanes take them in when there
// are fewer lanes than issues. A declared issue and one `run:add` put in are the same: neither holds
// the others up, and an order that matters is a blocked-by link (`backlog-drive-blocked.ts`). When
// every one left is in flight, nothing is named and the pool fills the free lanes (joshuafolkken/kit#6883).
function pending_of(carry: RunCarry, in_flight: ReadonlyArray<string>): ReadonlyArray<number> {
	const remaining = run_carry.remaining_of(carry) ?? []

	return remaining.filter((issue) => !in_flight.includes(String(issue)))
}

// **An `--only` run ends once nothing it named is left and nothing is in flight**
// (joshuafolkken/kit#4746): the stop's reason is read when it is offered, so one offered while a lane
// still ran would name that lane's issue unmerged even after it merged. A bare `--only` declared none:
// it runs only what `run:add` puts in, so it is idle rather than ended (`undefined`), and the caller
// holds it in the idle watch instead of the pool (joshuafolkken/kit#8923).
function only_end(carry: RunCarry, state: DriveState): OfferRead | undefined {
	if (state.in_flight.length > 0) {
		return { verdict: 'wait', issues: [], retries: NO_RETRIES, cause: ONLY_WAIT }
	}

	if (run_invocation.issue_numbers(carry.invocation) === undefined) return undefined

	return { verdict: 'stop', issues: [], retries: NO_RETRIES, reason: 'only', is_finish: true }
}

function offer(carry: RunCarry, state: DriveState, is_only: boolean): OfferRead | undefined {
	const pending = pending_of(carry, state.in_flight)

	if (pending.length > 0) {
		return { verdict: 'run', issues: pending.map(String), retries: NO_RETRIES }
	}

	return is_only ? only_end(carry, state) : undefined
}

function is_done(result: MergeResult): boolean {
	if (TERMINAL_OUTCOMES.has(result.outcome)) {
		return result.code === 0 && result.token !== MERGE_TOKEN.BUSY
	}

	return (
		result.outcome === 'failed' && result.code === 0 && !run_merge_token.is_control_stop(result)
	)
}

function can_mark(carry: RunCarry, issue: string, owner: string): boolean {
	const is_named = run_carry.remaining_of(carry)?.includes(Number(issue)) === true
	const is_owned = !run_carry.is_count_refused(carry, run_carry.owner_of(Number(owner)))

	return is_named && is_owned
}

function mark_one(target: string, issue: string, owner: string): boolean {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried' || !can_mark(read.carry, issue, owner)) return false
	run_carry.apply_change(target, read.carry, { done: Number(issue) })

	return true
}

async function carry_target(): Promise<string | undefined> {
	const directory = await run_carry.repository_directory()

	return directory === undefined ? undefined : run_carry.carry_path(directory)
}

// A named issue settled before this run dispatched it — closed, or parked — is booked done.
async function mark_settled(issue: string, owner: string): Promise<void> {
	const target = await carry_target()

	if (target !== undefined) mark_one(target, issue, owner)
}

// **A named issue that failed or parked skips nothing** (joshuafolkken/kit#8953): it is booked done so
// the run moves past it, and the other named issues run as they would have.
async function mark_done(issue: string, result: MergeResult, owner: string): Promise<void> {
	if (is_done(result)) await mark_settled(issue, owner)
}

async function reconcile(
	carry: RunCarry,
	events: ReadonlyArray<RunEvent>,
	owner: string,
): Promise<void> {
	const named = run_carry.remaining_of(carry) ?? []
	const settled = backlog_drive_restore.settled_issues(events)
	const parked = backlog_drive_restore.parked_issues(events)
	const merged = new Set(carry.merged_issues)
	const completed = named.filter((issue) => settled.has(issue) || merged.has(issue))

	for (const issue of completed) {
		const outcome = parked.has(issue) ? 'parked' : 'merged'

		// eslint-disable-next-line no-await-in-loop -- each mark rewrites the same carry file
		await mark_done(String(issue), { outcome, code: 0, token: 'none', is_offer: true }, owner)
	}
}

// The issues the run names: the declared list in its order, with the ones `run:add` put in.
function named_issues(carry: RunCarry): ReadonlyArray<number> {
	return run_carry_added.ordered(run_invocation.issue_numbers(carry.invocation) ?? [], carry.added)
}

// **A `--only` run adopts only the carried lanes it names** (joshuafolkken/kit#4282): it drains
// nothing, and its stop waits for every lane in flight, so a lane an earlier invocation dispatched for
// another issue would hold the run's end until that issue settled. The next draining run collects it.
function own_carried(
	carry: RunCarry,
	dispatched: ReadonlyArray<string>,
	is_only: boolean,
): ReadonlyArray<string> {
	if (!is_only) return dispatched
	const named = named_issues(carry)

	return dispatched.filter((issue) => named.includes(Number(issue)))
}

export const backlog_drive_named = {
	pending_of,
	offer,
	mark_done,
	mark_settled,
	named_issues,
	own_carried,
	reconcile,
}
