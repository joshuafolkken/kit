import { PrConflictError } from '#scripts/gh/git-pr-checks-eval'
import type { PrStateSnapshot } from '#scripts/gh/git-pr-checks-parse'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { time_followup_stage } from '#scripts/time-runtime/time-followup-stage'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { followup_ci_path } from './followup-ci-path'
import { git_followup_stages, type StageLog } from './git-followup-stages'

const { STAGE, STAGE_LINE_PREFIX, STAGE_TOTAL_PREFIX } = git_followup_stages

// The clock the laps are read from, driven rather than waited on: a lap measured against the real
// `performance.now()` is a duration nobody chose, and a test asserting one would either assert
// nothing or flake.
const CLOCK_START = 1000
const FIRST_LAP_MS = 2500
const SECOND_LAP_MS = 500

function drive_clock(...offsets: ReadonlyArray<number>): void {
	let index = 0
	let elapsed = CLOCK_START

	vi.spyOn(performance, 'now').mockImplementation(() => {
		const current = elapsed

		elapsed += offsets[index] ?? 0
		index += 1

		return current
	})
}

// A log whose two laps are exactly `FIRST_LAP_MS` and `SECOND_LAP_MS` long.
function two_lap_log(): StageLog {
	drive_clock(FIRST_LAP_MS, SECOND_LAP_MS)
	const log = git_followup_stages.new_log()

	git_followup_stages.lap(log, STAGE.checks_wait)
	git_followup_stages.lap(log, STAGE.telegram_and_merge)

	return log
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('git_followup_stages.lap', () => {
	it('records each stage in the order it was marked', () => {
		const log = two_lap_log()

		expect(log.stages.map((stage) => stage.name)).toStrictEqual([
			STAGE.checks_wait,
			STAGE.telegram_and_merge,
		])
	})

	it('measures a lap from the previous mark, not from the log opening', () => {
		const log = two_lap_log()

		expect(log.stages.map((stage) => stage.duration_ms)).toStrictEqual([
			FIRST_LAP_MS,
			SECOND_LAP_MS,
		])
	})

	it('totals the laps it recorded', () => {
		expect(git_followup_stages.total_ms(two_lap_log().stages)).toBe(FIRST_LAP_MS + SECOND_LAP_MS)
	})
})

// joshuafolkken/kit#3221: a wait that failed on a merge conflict names its last lap `conflict`.
describe('git_followup_stages.stopped_lap', () => {
	it('names the lap conflict for a merge conflict', () => {
		expect(git_followup_stages.stopped_lap(new PrConflictError('merge conflict'))).toBe(
			STAGE.conflict,
		)
	})

	it('keeps interrupted for any other failure', () => {
		expect(git_followup_stages.stopped_lap(new Error('failed checks'))).toBe(STAGE.interrupted)
	})
})

describe('git_followup_stages.format_stages', () => {
	it('opens every stage row with the single-sourced prefix', () => {
		const rows = git_followup_stages.format_stages(two_lap_log()).filter((line) => line !== '')

		expect(rows.slice(0, 2).every((row) => row.startsWith(STAGE_LINE_PREFIX))).toBe(true)
	})

	it('names the stage and its duration in seconds on one row', () => {
		const [, first] = git_followup_stages.format_stages(two_lap_log())

		expect(first).toContain(STAGE.checks_wait)
		expect(first).toContain(`${(FIRST_LAP_MS / MS_PER_SECOND).toFixed(1)} s`)
	})

	it('closes the block with the total of every lap', () => {
		const total = git_followup_stages.format_stages(two_lap_log()).at(-1) ?? ''

		expect(total.startsWith(STAGE_TOTAL_PREFIX)).toBe(true)
		expect(total).toContain(`${((FIRST_LAP_MS + SECOND_LAP_MS) / MS_PER_SECOND).toFixed(1)} s`)
	})

	// A run that threw before its first lap measured nothing, and a `0.0 s` total would read as a
	// measurement of a command that took no time.
	it('prints nothing at all for a log with no lap', () => {
		drive_clock()

		expect(git_followup_stages.format_stages(git_followup_stages.new_log())).toStrictEqual([])
	})
})

// #5131: the completion row is printed outside the block, so the one row has to read back on its own.
describe('git_followup_stages.format_stage', () => {
	it('prints a lone row the stage reader reads back', () => {
		const row = git_followup_stages.format_stage({
			name: STAGE.completion,
			duration_ms: FIRST_LAP_MS,
		})

		expect(time_followup_stage.read_stages(row)).toStrictEqual([
			{ name: STAGE.completion, duration_ms: FIRST_LAP_MS },
		])
	})
})

describe('git_followup_stages.print_stages', () => {
	it('writes one console line per formatted row', () => {
		const log = two_lap_log()
		const expected = git_followup_stages.format_stages(log)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		git_followup_stages.print_stages(log)

		expect(info.mock.calls.map(([line]) => String(line))).toStrictEqual(expected)
	})
})

// joshuafolkken/kit#5295: the `ci-wait` row names the check that settled last, and when each did.
function e2e(status: string): PrStateSnapshot {
	return {
		rollup: [{ name: 'e2e', status }],
		merge_state_status: undefined,
		review_decision: undefined,
	}
}

describe('git_followup_stages.record_waits — the CI wait critical path', () => {
	it('carries the last check to settle and each check time on the ci-wait row', async () => {
		const record = vi.spyOn(lane_ledger_write, 'record_stage').mockResolvedValue()
		const log = git_followup_stages.new_log()

		git_followup_stages.hold_issue(log, '42')
		followup_ci_path.observe(log.ci_path, e2e('pending'), 0)
		followup_ci_path.observe(log.ci_path, e2e('pass'), FIRST_LAP_MS)
		git_followup_stages.lap(log, STAGE.checks_wait)
		await git_followup_stages.record_waits(log)

		expect(record.mock.calls[0]?.[0]).toMatchObject({
			stage: lane_ledger_write.CI_WAIT_STAGE,
			issue: 42,
			last_check: 'e2e',
			check_ms: { e2e: FIRST_LAP_MS },
		})
	})
})

describe('git_followup_stages.hold_issue', () => {
	it.each([undefined, '', 'abc', '0'])('holds no issue for %j', (issue_number) => {
		const log = git_followup_stages.new_log()

		git_followup_stages.hold_issue(log, issue_number)

		expect(log.issue).toBeUndefined()
	})
})
