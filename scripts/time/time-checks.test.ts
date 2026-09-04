import { describe, expect, it } from 'vitest'
import { time_checks, type CheckTotal } from './time-checks'
import type { CheckRun } from './time-github'

// What a CI check's row says beyond its duration (joshuafolkken/kit#1310).
//
// The set below is the one the Issue was filed from, shaped as it was measured: a merge with jobs
// finishing on both sides of it, a job that never ran, and a job that finished in no measurable time
// at all. Every case here reads off that one set, because the whole point is that the rows can only
// be told apart *together* — each of them is `0.0 min` or `6.0 min` on its own.

const MINUTE_MS = 60_000
const MERGED_MS = 10 * MINUTE_MS
const SUCCESS = 'success'

function run(name: string, conclusion: string, started: number, completed: number): CheckRun {
	return {
		name,
		conclusion,
		started_ms: started * MINUTE_MS,
		completed_ms: completed * MINUTE_MS,
	}
}

const UNIT = 'unit'
const SONAR = 'SonarQube'
const E2E = 'E2E'
const CODERABBIT = 'CodeRabbit'
const NOTIFY = 'Notify Auto Tag'
const SKIPPED = time_checks.SKIPPED_CONCLUSION

// The merge sits at minute 10. `unit` finishes right at it, `CodeRabbit` runs on for four minutes
// past it, `E2E` was skipped outright, and `Notify Auto Tag` fires after the merge and takes no
// measurable time — the three zero-or-late rows the old table printed identically.
const SPANNING: ReadonlyArray<CheckRun> = [
	run(UNIT, SUCCESS, 2, 10),
	run(SONAR, SUCCESS, 2, 6),
	run(E2E, SKIPPED, 2, 2),
	run(CODERABBIT, SUCCESS, 8, 14),
	run(NOTIFY, SUCCESS, 11, 11),
]

// What the set above is expected to become: sorted longest first, each row carrying what it concluded
// and how far its finish sat from the merge. Declared here rather than inside the assertion so the
// expectation reads as one statement about the whole set.
const EXPECTED: ReadonlyArray<CheckTotal> = [
	{ label: UNIT, duration_ms: 8 * MINUTE_MS, conclusion: SUCCESS, merge_gap_ms: 0 },
	{
		label: CODERABBIT,
		duration_ms: 6 * MINUTE_MS,
		conclusion: SUCCESS,
		merge_gap_ms: 4 * MINUTE_MS,
	},
	{ label: SONAR, duration_ms: 4 * MINUTE_MS, conclusion: SUCCESS, merge_gap_ms: -4 * MINUTE_MS },
	{ label: E2E, duration_ms: 0, conclusion: SKIPPED, merge_gap_ms: -8 * MINUTE_MS },
	{ label: NOTIFY, duration_ms: 0, conclusion: SUCCESS, merge_gap_ms: MINUTE_MS },
]

function totals(): Array<CheckTotal> {
	return time_checks.build_check_totals(SPANNING, MERGED_MS)
}

// Throwing rather than returning an optional: every lookup below names a row the fixture declares, so
// a miss is a broken fixture and an assertion made against `undefined` would hide it.
function total_of(label: string): CheckTotal {
	const found = totals().find((check) => check.label === label)

	if (found === undefined) throw new Error(`the fixture has no check named ${label}`)

	return found
}

function only_total(check: CheckRun): CheckTotal {
	const [only] = time_checks.build_check_totals([check], MERGED_MS)

	if (only === undefined) throw new Error('no check total was built')

	return only
}

describe('time_checks.build_check_totals — a set that spans the merge', () => {
	// The acceptance criterion, stated whole: one set, one expected classification.
	it('classifies every check in the set, longest first', () => {
		expect(totals()).toEqual(EXPECTED)
	})

	it('marks only the checks that finished past the merge as after it', () => {
		const late = totals().filter((check) => time_checks.is_after_merge(check))

		expect(late.map((check) => check.label)).toEqual([CODERABBIT, NOTIFY])
	})

	// GitHub really does stamp a check as completed a fraction of a second before it started — `Notify
	// Auto Tag` on PR #1277 printed as `-0.0 min`, which a reader takes for a figure.
	it('never reports a negative duration for a check whose clocks disagree', () => {
		expect(only_total(run('notify', SUCCESS, 7, 6)).duration_ms).toBe(0)
	})
})

describe('time_checks.check_suffix — what a row says beside its duration', () => {
	it('names what the check concluded', () => {
		expect(time_checks.check_suffix(total_of(UNIT))).toBe(SUCCESS)
	})

	// The two readings of a zero-length row. Collapsed into one, `E2E 0.0 min` and
	// `Notify Auto Tag 0.0 min` are the same line for a job that never ran and a job that ran and
	// finished at once.
	it('tells a skipped zero-length row from one that completed instantly', () => {
		const skipped = time_checks.check_suffix(total_of(E2E))
		const instant = time_checks.check_suffix(total_of(NOTIFY))

		expect(skipped).toContain(time_checks.SKIPPED_NOTE)
		expect(skipped).not.toContain(time_checks.INSTANT_NOTE)
		expect(instant).toContain(time_checks.INSTANT_NOTE)
		expect(instant).not.toContain(time_checks.SKIPPED_NOTE)
	})

	it('says how long after the merge a late check finished', () => {
		expect(time_checks.check_suffix(total_of(CODERABBIT))).toBe(
			`success · finished 4.0 min ${time_checks.AFTER_MERGE_NOTE}`,
		)
	})

	// An empty conclusion is GitHub having sent none, and a blank column would read as a check with
	// nothing to report.
	it('says so where GitHub sent no conclusion at all', () => {
		const ungraded = only_total(run('mystery', '', 2, 6))

		expect(time_checks.check_suffix(ungraded)).toBe(time_checks.NO_CONCLUSION)
	})
})

describe('time_checks.merge_wait_lines — which check the merge actually waited on', () => {
	it('names the last check to finish before the merge', () => {
		const [line] = time_checks.merge_wait_lines(totals())

		expect(line).toContain(`${time_checks.MERGE_WAIT_PREFIX} ${UNIT}`)
		expect(line).toContain(time_checks.MERGE_WAIT_SUFFIX)
	})

	// The whole argument of the Issue: `CodeRabbit` is the longest row in the table and finished four
	// minutes after the merge, so ranking the wait off duration alone points at the one job the merge
	// never waited for.
	it('never names the longest check when it finished after the merge', () => {
		expect(time_checks.merge_wait_lines(totals())[0]).not.toContain(CODERABBIT)
	})

	it('never names a check that was skipped', () => {
		const skipped_only = [run(E2E, SKIPPED, 2, 2)]
		const [line] = time_checks.merge_wait_lines(
			time_checks.build_check_totals(skipped_only, MERGED_MS),
		)

		expect(line).toContain(time_checks.NO_BLOCKING_CHECK)
	})

	it('says nothing at all where no check was read', () => {
		expect(time_checks.merge_wait_lines([])).toEqual([])
	})

	// CI green three minutes in and a person merging two hours later is an ordinary run — a `halfrun`
	// picked up the next morning, a pull request left for a review. Saying the merge waited on CI there
	// attributes a two-hour human wait to the checks, which is the misattribution this whole change
	// exists to remove.
	it('never says the merge waited on CI when the merge came long afterwards', () => {
		const early = time_checks.build_check_totals([run(UNIT, SUCCESS, 0, 2)], MERGED_MS)
		const [line] = time_checks.merge_wait_lines(early)

		expect(line).toContain(`${UNIT} ${time_checks.LAST_TO_FINISH_NOTE} 8.0 min`)
		expect(line).toContain(time_checks.BEFORE_MERGE_SUFFIX)
		expect(line).not.toContain(time_checks.MERGE_WAIT_PREFIX)
	})
})

// A skipped job's two stamps are the moment the workflow evaluated the `if:` that turned it off, so
// there is nothing there to place either side of the merge.
describe('time_checks.check_suffix — a skipped job stamped after the merge', () => {
	it('says it did not run and claims nothing about the merge', () => {
		const late_skip = only_total(run(NOTIFY, SKIPPED, 12, 12))

		expect(time_checks.check_suffix(late_skip)).toBe(`${SKIPPED} · ${time_checks.SKIPPED_NOTE}`)
	})
})
