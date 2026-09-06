import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { time_history, type RunTimeRecord } from './time-history'
import { time_report_fixture } from './time-report-fixture'

// joshuafolkken/kit#1471. The report only existed while a session was looking at it, so what these
// cases are really about is the record surviving the run: what is written, what is compared against
// it, and what happens when the measurement itself cannot be taken.

const WORK_ROOT = mkdtempSync(path.join(tmpdir(), 'time-history-'))
const MS_PER_MINUTE = 60_000
const RECORDED_AT = '2026-01-01T00:00:00.000Z'
const PREVIOUS_ISSUE = 1470
const CURRENT_ISSUE = 1471
const TURN_COUNT = 40
const TOOL_CALL_COUNT = 120
const MS_PER_ROUND_TRIP = 27_000
const MODEL_MS_PER_ROUND_TRIP = 22_000
const CI_MS = 2 * MS_PER_MINUTE
const BUILD_FAILURE = 'gh is not authenticated'
const NO_PREVIOUS_LABEL = 'vs previous'
const NO_PREVIOUS_TEXT = 'no earlier run recorded'
// A path that is only ever joined and compared, never written to — so it is deliberately not under
// the temp directory the writing cases use.
const SAMPLE_ROOT = path.join('some', 'project')

function record(issue: number, elapsed_minutes: number, round_trip_count: number): RunTimeRecord {
	return {
		issue,
		recorded_at: RECORDED_AT,
		elapsed_ms: elapsed_minutes * MS_PER_MINUTE,
		turn_count: TURN_COUNT,
		tool_call_count: TOOL_CALL_COUNT,
		round_trip_count,
		ms_per_round_trip: MS_PER_ROUND_TRIP,
		model_ms_per_round_trip: MODEL_MS_PER_ROUND_TRIP,
	}
}

function history_text(): string {
	return readFileSync(time_history.history_path(WORK_ROOT), 'utf8')
}

function row_of(lines: ReadonlyArray<string>, label: string): string {
	return lines.find((line) => line.includes(label)) ?? ''
}

async function build_report(): Promise<ReturnType<typeof time_report_fixture.run_report>> {
	return time_report_fixture.run_report(time_report_fixture.MIXED, CI_MS)
}

async function fail_to_build(): Promise<never> {
	throw new Error(BUILD_FAILURE)
}

// What `build_run_report` returns for a run it could attribute no transcript to: every count zero,
// with the reason in `notes` rather than an exception.
async function build_unmeasured(): Promise<ReturnType<typeof time_report_fixture.run_report>> {
	return time_report_fixture.run_report([], 0)
}

function now(): string {
	return RECORDED_AT
}

beforeEach(() => {
	writeFileSync(time_history.history_path(WORK_ROOT), '', 'utf8')
})

// Undone after each case rather than before the next one, so the last case of the file cannot leave
// `JOSH_TIME_HISTORY` stubbed behind it.
afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	rmSync(WORK_ROOT, { recursive: true, force: true })
})

describe('time_history.history_path', () => {
	it('names the history file under the given root', () => {
		expect(time_history.history_path(SAMPLE_ROOT)).toBe(
			path.join(SAMPLE_ROOT, time_history.HISTORY_FILE_NAME),
		)
	})
})

describe('time_history.append_record', () => {
	it('reads back what it wrote', () => {
		const written = record(CURRENT_ISSUE, 30, 100)

		time_history.append_record(WORK_ROOT, written)

		expect(time_history.read_records(WORK_ROOT)).toStrictEqual([written])
	})

	// The point of the file: a second run does not replace the first, so the two can be compared.
	it('accumulates across runs in the order they finished', () => {
		time_history.append_record(WORK_ROOT, record(PREVIOUS_ISSUE, 30, 100))
		time_history.append_record(WORK_ROOT, record(CURRENT_ISSUE, 33, 112))

		expect(time_history.read_records(WORK_ROOT).map((entry) => entry.issue)).toStrictEqual([
			PREVIOUS_ISSUE,
			CURRENT_ISSUE,
		])
	})

	// The interrupt the format is built to survive leaves a line with no newline after it. Appended
	// straight onto, the next run's JSON would join that fragment and be dropped with it — so this
	// run's own record would vanish, which is the one loss the format is meant to rule out.
	it('starts a new line after a fragment left by an interrupted write', () => {
		writeFileSync(time_history.history_path(WORK_ROOT), '{"issue":', 'utf8')

		time_history.append_record(WORK_ROOT, record(CURRENT_ISSUE, 30, 100))

		expect(time_history.read_records(WORK_ROOT).map((entry) => entry.issue)).toStrictEqual([
			CURRENT_ISSUE,
		])
	})

	// A run interrupted mid-write leaves a truncated tail. Losing that one line is the cost; losing
	// every earlier run's record with it would empty the sample the comparison is built on.
	it('drops a line that does not parse and keeps the rest', () => {
		time_history.append_record(WORK_ROOT, record(PREVIOUS_ISSUE, 30, 100))
		writeFileSync(time_history.history_path(WORK_ROOT), `${history_text()}{"issue":`, 'utf8')

		expect(time_history.read_records(WORK_ROOT).map((entry) => entry.issue)).toStrictEqual([
			PREVIOUS_ISSUE,
		])
	})

	it('reports an absent history as no runs rather than failing', () => {
		expect(time_history.read_records(path.join(WORK_ROOT, 'missing'))).toStrictEqual([])
	})
})

describe('time_history.append_record — the cap', () => {
	// The trim is the one write that rewrites the file whole, so it is taken once the file has run
	// `TRIM_SLACK` past the cap rather than on every run beyond it.
	it('trims back to the newest MAX_RECORDS once the slack is used up', () => {
		const overflow = time_history.MAX_RECORDS + time_history.TRIM_SLACK + 1

		for (let index = 0; index < overflow; index += 1) {
			time_history.append_record(WORK_ROOT, record(index, 30, 100))
		}

		const kept = time_history.read_records(WORK_ROOT)

		expect(kept).toHaveLength(time_history.MAX_RECORDS)
		expect(kept[0]?.issue).toBe(overflow - time_history.MAX_RECORDS)
	})

	it('leaves the file untrimmed while it is still inside the slack', () => {
		const within = time_history.MAX_RECORDS + time_history.TRIM_SLACK

		for (let index = 0; index < within; index += 1) {
			time_history.append_record(WORK_ROOT, record(index, 30, 100))
		}

		expect(time_history.read_records(WORK_ROOT)).toHaveLength(within)
	})
})

describe('time_history.to_record', () => {
	it('carries the report figures two runs are compared on', () => {
		const report = time_report_fixture.run_report(time_report_fixture.MIXED, CI_MS)
		const kept = time_history.to_record(CURRENT_ISSUE, report, RECORDED_AT)

		// Every field, not a sample of them: a mapping that dropped one would still pass a partial
		// assertion, and the dropped figure is what the next run is compared on.
		expect(kept).toStrictEqual({
			issue: CURRENT_ISSUE,
			recorded_at: RECORDED_AT,
			started_at: report.started_at,
			ended_at: report.ended_at,
			elapsed_ms: report.elapsed_ms,
			turn_count: report.turn_count,
			tool_call_count: report.tool_call_count,
			round_trip_count: report.round_trip_count,
			ms_per_round_trip: report.ms_per_round_trip,
			model_ms_per_round_trip: report.model_ms_per_round_trip,
		})
	})
})

describe('time_history.format_block — the comparison against the previous run', () => {
	it('says so when there is no earlier run to compare against', () => {
		const lines = time_history.format_block([record(CURRENT_ISSUE, 30, 100)])

		expect(row_of(lines, NO_PREVIOUS_LABEL)).toContain(NO_PREVIOUS_TEXT)
	})

	it('names the previous run and the direction the elapsed time moved', () => {
		const lines = time_history.format_block([
			record(PREVIOUS_ISSUE, 30, 100),
			record(CURRENT_ISSUE, 33, 112),
		])
		const comparison = row_of(lines, `vs #${String(PREVIOUS_ISSUE)}`)

		// The whole suffix rather than each figure on its own: the two are separated parts, and a row
		// that ran them together would still pass a `toContain` for either half.
		expect(comparison).toContain('+3.0 min')
		expect(comparison).toContain('+10.0% · round trips +12')
	})

	// A previous run of no measured elapsed time has no percentage to give, so the row carries the
	// parts it does have rather than a division by zero.
	it('withholds the percentage when the previous run measured no elapsed time', () => {
		const lines = time_history.format_block([
			record(PREVIOUS_ISSUE, 0, 100),
			record(CURRENT_ISSUE, 30, 112),
		])

		expect(row_of(lines, `vs #${String(PREVIOUS_ISSUE)}`)).toContain('   round trips +12')
	})

	it('signs a run that got faster as a decrease', () => {
		const lines = time_history.format_block([
			record(PREVIOUS_ISSUE, 40, 120),
			record(CURRENT_ISSUE, 30, 100),
		])
		const comparison = row_of(lines, `vs #${String(PREVIOUS_ISSUE)}`)

		expect(comparison).toContain('-10.0 min')
		expect(comparison).toContain('-25.0% · round trips -20')
	})
})

// `josh followup --merge` is re-runnable — a merge that succeeded with a failing step after it is
// finished by re-invoking it — so the record immediately before this one can be this same run
// measured twice, which would print `+0.0 min` as though nothing had changed between two runs.
describe('time_history.format_block — a re-run of the same issue', () => {
	it('compares against the newest record for a different issue', () => {
		const lines = time_history.format_block([
			record(PREVIOUS_ISSUE, 30, 100),
			record(CURRENT_ISSUE, 33, 112),
			record(CURRENT_ISSUE, 33, 112),
		])

		expect(row_of(lines, 'vs #')).toContain(`vs #${String(PREVIOUS_ISSUE)}`)
		// The plural branch of the run count, which the single-record cases below cannot reach.
		expect(lines.join('\n')).toContain('(3 runs in')
	})

	it('says there is nothing to compare against when every record is this issue', () => {
		const lines = time_history.format_block([
			record(CURRENT_ISSUE, 33, 112),
			record(CURRENT_ISSUE, 33, 112),
		])

		expect(row_of(lines, NO_PREVIOUS_LABEL)).toContain(NO_PREVIOUS_TEXT)
	})
})

describe('time_history.format_block — the run that just finished', () => {
	it('carries the run figures and how many runs the file now holds', () => {
		const lines = time_history.format_block([record(CURRENT_ISSUE, 30, 100)])

		expect(lines.join('\n')).toContain(`issue #${String(CURRENT_ISSUE)} (1 run in`)
		expect(row_of(lines, 'elapsed')).toContain('30.0 min')
		expect(row_of(lines, 'per round trip')).toContain('27.0 s')
	})

	it('renders nothing when there is no record at all', () => {
		expect(time_history.format_block([])).toStrictEqual([])
	})
})

describe('time_history.record_run', () => {
	it('records the finished run and renders it', async () => {
		const lines = await time_history.record_run(CURRENT_ISSUE, WORK_ROOT, build_report, now)

		expect(time_history.read_records(WORK_ROOT).map((entry) => entry.issue)).toStrictEqual([
			CURRENT_ISSUE,
		])
		expect(lines.join('\n')).toContain(`issue #${String(CURRENT_ISSUE)}`)
	})

	// The call happens after the merge, so a failure here is reported and never raised: a finished
	// run must not be made to look broken by the measurement taken of it.
	it('reports an unavailable measurement instead of throwing', async () => {
		const lines = await time_history.record_run(CURRENT_ISSUE, WORK_ROOT, fail_to_build, now)

		expect(lines.join('\n')).toContain(BUILD_FAILURE)
		expect(time_history.read_records(WORK_ROOT)).toStrictEqual([])
	})

	// The zeros are an unknown, not a fast run. Recorded, they become the baseline the next real run
	// is compared against — and `signed_share`'s divide-by-zero guard would hide the percentage that
	// is the only sign anything is wrong.
	it('does not record a run nothing was measured for', async () => {
		const lines = await time_history.record_run(CURRENT_ISSUE, WORK_ROOT, build_unmeasured, now)

		expect(time_history.read_records(WORK_ROOT)).toStrictEqual([])
		expect(lines.join('\n')).toContain('unavailable')
	})

	it('writes nothing when JOSH_TIME_HISTORY is 0', async () => {
		vi.stubEnv('JOSH_TIME_HISTORY', '0')

		expect(
			await time_history.record_run(CURRENT_ISSUE, WORK_ROOT, build_report, now),
		).toStrictEqual([])
		expect(time_history.read_records(WORK_ROOT)).toStrictEqual([])
	})
})
