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

	const current = carry.merged_issues ?? []

	return current.includes(issue) ? current : [...current, issue]
}

function is_duplicate_merge(carry: RunCarry, change: CarryChange): boolean {
	const issue = change.merged_issue

	return issue !== undefined && carry.merged_issues?.includes(issue) === true
}

// Whether a change carries anything besides its merge — a filing, a cut, a streak step, a done issue
// or the retrospective mark.
function has_other_change(change: CarryChange): boolean {
	const amounts = [change.filed, change.cuts, change.failures, change.outages]
	const has_amount = amounts.some((amount) => (amount ?? NO_INCREMENT) > NO_INCREMENT)

	return has_amount || change.done !== undefined || change.retrospective === true
}

// **A duplicate merge drops only the merge**: `--merged <issue>` may ride
// beside `--filed` or `--done` in one call, and those are still increments the record has not seen.
// Only a duplicate carrying nothing else leaves the record untouched, which is `undefined` here.
function effective_change(carry: RunCarry, change: CarryChange): CarryChange | undefined {
	if (!is_duplicate_merge(carry, change)) return change

	return has_other_change(change) ? { ...change, merged: NO_INCREMENT } : undefined
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
	const effective = effective_change(carry, change)

	if (effective === undefined) return carry

	const streak = run_carry_streak.next_state(carry, effective, now)
	const next: RunCarry = {
		...carry,
		...next_counts(carry, effective),
		merged_issues: next_merged_issues(carry, effective.merged_issue),
		failures: streak.failures,
		outages: streak.outages,
		last_outage_at: streak.last_outage_at,
		done: next_done(carry, effective.done),
		retrospective: effective.retrospective === true || carry.retrospective,
	}

	stamp_file.write_stamp(target, next)

	return next
}

export const run_carry_change = { apply_change }
