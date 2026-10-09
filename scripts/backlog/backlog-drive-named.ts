import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { run_carry, type RunCarry } from '#scripts/run/carry/run-carry'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_invocation } from '#scripts/run/run-invocation'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_named } from './backlog-named'

const NO_RETRIES = 0
const FIRST = 0
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set(['merged', 'parked', 'split'])

// The skip follows the declared order alone: an issue `run:add` put in was
// asked for on its own, so its failure skips nothing and a declared failure does not skip it.
function is_declared(carry: RunCarry, issue: string): boolean {
	return run_invocation.issue_numbers(carry.invocation)?.includes(Number(issue)) === true
}

// An issue `run:add` put in that is already in flight holds nothing up: it was
// asked for on its own, so the declared item behind it — an epic whose children fill the free lanes —
// is offered beside it. A declared issue in flight still holds the ones declared after it.
function is_held(carry: RunCarry, state: DriveState, issue: number): boolean {
	return !state.in_flight.includes(String(issue)) || is_declared(carry, String(issue))
}

function next_of(carry: RunCarry, state: DriveState): number | undefined {
	const remaining = run_carry.remaining_of(carry) ?? []

	return remaining.find((issue) => is_held(carry, state, issue)) ?? remaining[FIRST]
}

function offer(carry: RunCarry, state: DriveState, is_only: boolean): OfferRead | undefined {
	const next = next_of(carry, state)

	if (next !== undefined) {
		const issue = String(next)

		return state.in_flight.includes(issue)
			? { verdict: 'wait', issues: [], retries: NO_RETRIES }
			: { verdict: 'run', issues: [issue], retries: NO_RETRIES }
	}

	return is_only
		? { verdict: 'stop', issues: [], retries: NO_RETRIES, reason: 'only', is_finish: true }
		: undefined
}

function is_done(result: MergeResult): boolean {
	if (TERMINAL_OUTCOMES.has(result.outcome)) return result.code === 0 && result.token !== 'busy'

	return result.outcome === 'failed' && result.code === 0 && result.token !== 'stop'
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
	const read = await issue_state_cli.read_issue(issue)

	return read.kind === 'state' && has_label_name(read.state.labels, NEEDS_DECISION_LABEL)
}

async function mark_done(issue: string, result: MergeResult, owner: string): Promise<void> {
	if (!is_done(result)) return
	const directory = await run_carry.repository_directory()
	if (directory === undefined) return
	const target = run_carry.carry_path(directory)
	if (!mark_one(target, issue, owner)) return
	if (await should_skip(issue, result.outcome)) skip_after_failure(target, issue, owner)
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
		await mark_done(String(issue), { outcome, code: 0, token: 'none' }, owner)
	}
}

export const backlog_drive_named = { offer, mark_done, reconcile }
