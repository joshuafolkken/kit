import { lane_parked } from '#scripts/lane/lane-parked'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_added } from '#scripts/run/carry/run-carry-added'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_token } from '#scripts/run/merge/run-merge-token'
import { run_invocation } from '#scripts/run/run-invocation'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_named } from './backlog-named'

const { MERGE_TOKEN } = run_merge_token

const NO_RETRIES = 0
const FIRST = 0
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set([
	'merged',
	'parked',
	'human-review',
	'split',
	'withdrawn',
])

// The skip follows the declared order alone: an issue `run:add` put in was
// asked for on its own, so its failure skips nothing and a declared failure does not skip it.
function is_declared(carry: RunCarry, issue: string): boolean {
	return run_invocation.issue_numbers(carry.invocation)?.includes(Number(issue)) === true
}

// An issue `run:add` put in that is already in flight holds nothing up: it was
// asked for on its own, so the declared item behind it — an epic whose children fill the free lanes —
// is offered beside it. A declared issue in flight still holds the ones declared after it.
function is_held(carry: RunCarry, in_flight: ReadonlyArray<string>, issue: number): boolean {
	return !in_flight.includes(String(issue)) || is_declared(carry, String(issue))
}

function next_of(carry: RunCarry, in_flight: ReadonlyArray<string>): number | undefined {
	const remaining = run_carry.remaining_of(carry) ?? []

	return remaining.find((issue) => is_held(carry, in_flight, issue)) ?? remaining[FIRST]
}

// The declared issue `issue` starts after while the declared order holds it: the one declared just
// before it, once it is behind `next_of` — what `offer` runs or waits on — whether that has started yet
// or not (joshuafolkken/kit#4279). `run:board` names it on the queued row; an issue `run:add` put in, or
// one already in flight, is held by nothing.
function held_after(
	carry: RunCarry,
	in_flight: ReadonlyArray<string>,
	issue: number,
): number | undefined {
	const next = next_of(carry, in_flight)
	if (next === undefined || in_flight.includes(String(issue))) return undefined
	const declared = (run_carry.remaining_of(carry) ?? []).filter((number) =>
		is_declared(carry, String(number)),
	)
	const index = declared.indexOf(issue)

	return index > declared.indexOf(next) ? declared[index - 1] : undefined
}

// **An `--only` run ends once nothing it named is left and nothing is in flight**
// (joshuafolkken/kit#4746): the stop's reason is read when it is offered, so one offered while a lane
// still ran would name that lane's issue unmerged even after it merged.
function only_end(state: DriveState): OfferRead {
	return state.in_flight.length > 0
		? { verdict: 'wait', issues: [], retries: NO_RETRIES }
		: { verdict: 'stop', issues: [], retries: NO_RETRIES, reason: 'only', is_finish: true }
}

function offer(carry: RunCarry, state: DriveState, is_only: boolean): OfferRead | undefined {
	const next = next_of(carry, state.in_flight)

	if (next !== undefined) {
		const issue = String(next)

		return state.in_flight.includes(issue)
			? { verdict: 'wait', issues: [], retries: NO_RETRIES }
			: { verdict: 'run', issues: [issue], retries: NO_RETRIES }
	}

	return is_only ? only_end(state) : undefined
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

function skipped_of(carry: RunCarry, issue: string): ReadonlyArray<number> {
	if (!is_declared(carry, issue)) return []
	const remaining = run_carry.remaining_of({ ...carry, added: undefined }) ?? []
	const named = [
		{ issue: Number(issue), is_epic: false },
		...remaining.map((number) => ({ issue: number, is_epic: false })),
	]

	return backlog_named.after_failure(named, Number(issue)).skipped
}

function skip_after_failure(target: string, issue: string, owner: string): void {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return

	for (const number of skipped_of(read.carry, issue)) {
		if (!mark_one(target, String(number), owner)) return
	}
}

async function should_skip(issue: string, outcome: MergeResult['outcome']): Promise<boolean> {
	if (outcome === 'failed') return true
	if (outcome !== 'parked') return false

	return await lane_parked.is_parked(issue)
}

async function carry_target(): Promise<string | undefined> {
	const directory = await run_carry.repository_directory()

	return directory === undefined ? undefined : run_carry.carry_path(directory)
}

async function mark_done(issue: string, result: MergeResult, owner: string): Promise<void> {
	if (!is_done(result)) return
	const target = await carry_target()
	if (target === undefined || !mark_one(target, issue, owner)) return
	if (await should_skip(issue, result.outcome)) skip_after_failure(target, issue, owner)
}

// **A named issue settled before this run dispatched it skips nothing** (joshuafolkken/kit#4746): it
// did not fail inside the run, so booking the ones declared after it done would end an `--only` run
// over issues no lane ever started.
async function mark_settled(issue: string, owner: string): Promise<void> {
	const target = await carry_target()

	if (target !== undefined) mark_one(target, issue, owner)
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
	next_of,
	offer,
	held_after,
	mark_done,
	mark_settled,
	named_issues,
	own_carried,
	reconcile,
}
