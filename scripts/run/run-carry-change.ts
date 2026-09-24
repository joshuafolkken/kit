import { stamp_file } from '#scripts/josh/stamp-file'
import type { CarryChange, RunCarry } from './run-carry'
import { run_carry_streak } from './run-carry-streak'

const NO_INCREMENT = 0

function next_done(carry: RunCarry, done: number | undefined): ReadonlyArray<number> | undefined {
	if (done === undefined) return carry.done

	const current = carry.done ?? []

	return current.includes(done) ? current : [...current, done]
}

function next_merged_issues(
	carry: RunCarry,
	issue: number | undefined,
): ReadonlyArray<number> | undefined {
	if (issue === undefined) return carry.merged_issues

	return [...(carry.merged_issues ?? []), issue]
}

function is_duplicate_merge(carry: RunCarry, change: CarryChange): boolean {
	const issue = change.merged_issue

	return issue !== undefined && carry.merged_issues?.includes(issue) === true
}

function next_counts(
	carry: RunCarry,
	change: CarryChange,
): Pick<RunCarry, 'merged' | 'filed' | 'cuts' | 'is_handed_off'> {
	const cuts = change.cuts ?? NO_INCREMENT

	return {
		merged: carry.merged + (change.merged ?? NO_INCREMENT),
		filed: carry.filed + (change.filed ?? NO_INCREMENT),
		cuts: carry.cuts + cuts,
		is_handed_off: cuts > NO_INCREMENT,
	}
}

function apply_change(
	target: string,
	carry: RunCarry,
	change: CarryChange,
	now: Date = new Date(),
): RunCarry {
	if (is_duplicate_merge(carry, change)) return carry

	const streak = run_carry_streak.next_state(carry, change, now)
	const next: RunCarry = {
		...carry,
		...next_counts(carry, change),
		merged_issues: next_merged_issues(carry, change.merged_issue),
		failures: streak.failures,
		outages: streak.outages,
		last_outage_at: streak.last_outage_at,
		done: next_done(carry, change.done),
		retrospective: change.retrospective === true || carry.retrospective,
	}

	stamp_file.write_stamp(target, next)

	return next
}

export const run_carry_change = { apply_change }
