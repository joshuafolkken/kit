import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { run_carry, type RunCarry } from '#scripts/run/run-carry'
import type { RunEvent } from '#scripts/run/run-event-stream'
import type { MergeResult } from '#scripts/run/run-merge-cli'
import type { DriveState, OfferRead } from './backlog-drive'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_named } from './backlog-named'

const NO_RETRIES = 0
const FIRST = 0
const TERMINAL_OUTCOMES: ReadonlySet<string> = new Set(['merged', 'parked', 'split'])

function offer(carry: RunCarry, state: DriveState, is_only: boolean): OfferRead | undefined {
	const next = run_carry.remaining_of(carry)?.[FIRST]

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

function skip_after_failure(target: string, issue: string, owner: string): void {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return
	const remaining = run_carry.remaining_of(read.carry) ?? []
	const named = [
		{ issue: Number(issue), is_epic: false },
		...remaining.map((number) => ({ issue: number, is_epic: false })),
	]
	const { skipped } = backlog_named.after_failure(named, Number(issue))

	for (const number of skipped) {
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

		await mark_done(String(issue), { outcome, code: 0, token: 'none' }, owner)
	}
}

export const backlog_drive_named = { offer, mark_done, reconcile }
