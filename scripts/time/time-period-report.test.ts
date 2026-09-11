import { describe, expect, it } from 'vitest'
import type { RunTimeRecord } from './time-history'
import { time_period_fixture } from './time-period-fixture'
import { time_period_report } from './time-period-report'

// The one table a period is read as (joshuafolkken/kit#1470). The cases are the acceptance criteria
// at the level of one line: busy and idle beside each other per lane, a serialized stretch named by
// the run that held it, and the two kinds of wait told apart rather than summed.

const { HOUR_MS, MINUTE_MS, BASE_MS, ISSUE_A, ISSUE_B, SERIAL, OVERLAPPING } = time_period_fixture
const { record, build, with_turns } = time_period_fixture
const EXPOSED_LABEL = 'exposed bare'
const TURN_COUNT = 3

// One run holding a lane for three hours while a one-minute run passes it — the shape that produces
// a serialized stretch at all.
const CONTENDED = [
	record(ISSUE_A, BASE_MS, 3 * HOUR_MS),
	record(ISSUE_B, BASE_MS + HOUR_MS, MINUTE_MS),
]

function text_of(records: ReadonlyArray<RunTimeRecord>): string {
	const report = build(records)

	return report === undefined ? '' : time_period_report.format_period_report(report)
}

function line_of(records: ReadonlyArray<RunTimeRecord>, label: string): string {
	return (
		text_of(records)
			.split('\n')
			.find((line) => line.includes(label)) ?? ''
	)
}

describe('time_period_report.format_period_report — the turn breakdown', () => {
	// The same block `--last` prints, from the same module: a period and a last-N reading of the same
	// runs must not answer the question in different words (joshuafolkken/kit#1763).
	it('prints the contributor table in the aggregated format', () => {
		const turns = OVERLAPPING.map((entry) => with_turns(entry, { implementation: TURN_COUNT }))

		expect(text_of(turns)).toContain('Turns by contributor (median, then min – max):')
		expect(line_of(turns, 'implementation')).toContain('3 – 3 · 2 run(s)')
	})

	it('says not measured where no record carried a breakdown', () => {
		expect(line_of(OVERLAPPING, 'implementation')).toContain('not measured')
	})
})

describe('time_period_report.format_period_report heading', () => {
	it('names the period, the runs it holds and the lanes they occupied', () => {
		expect(text_of(OVERLAPPING)).toContain('last 7 day(s): 2 run(s) across 2 lane(s)')
	})

	it('puts the effective lane count and the throughput beside the window', () => {
		const window_line = line_of(OVERLAPPING, 'window')

		expect(window_line).toContain('2.0 effective of 2 lane(s)')
		expect(window_line).toContain('runs/hour')
	})
})

describe('time_period_report.format_period_report lanes', () => {
	it('reads busy, idle, share and the issues off one row per lane', () => {
		const lane_line = line_of(OVERLAPPING, 'lane 1')

		expect(lane_line).toContain('60.0 min')
		expect(lane_line).toContain('idle 0.0 min')
		expect(lane_line).toContain('100.0% busy')
		expect(lane_line).toContain(`#${String(ISSUE_A)}`)
	})

	it('says a single lane hid nothing rather than printing an empty comparison', () => {
		expect(text_of(SERIAL)).toContain('One lane only')
	})
})

describe('time_period_report.format_period_report contention', () => {
	it('names the run that held the only busy lane', () => {
		expect(line_of(CONTENDED, time_period_report.SERIAL_HEADING)).toBe(
			time_period_report.SERIAL_HEADING,
		)
		expect(line_of(CONTENDED, `#${String(ISSUE_A)} `)).toContain('119.0 min')
	})

	it('says so when nothing was serialized, rather than dropping the block', () => {
		expect(text_of(OVERLAPPING)).toContain(time_period_report.NO_SERIALIZATION)
	})

	it('tells a wait something else was hiding from a wait that was exposed', () => {
		expect(line_of(OVERLAPPING, 'hidden by another run')).toContain('100.0%')
		expect(line_of(OVERLAPPING, EXPOSED_LABEL)).toContain('0.0%')
		expect(line_of(SERIAL, EXPOSED_LABEL)).toContain('100.0%')
	})
})

describe('time_period_report.format_period_report trend', () => {
	// The date is on the window row as well, and the per-day block is the last thing printed — so the
	// row this case is about is the last one carrying the date, never the first.
	it('prints one row per day with the issues finished on it', () => {
		const rows = text_of(SERIAL)
			.split('\n')
			.filter((line) => line.includes('2026-09-01'))

		expect(rows.at(-1)).toContain('2 run(s)')
		expect(text_of(SERIAL)).toContain('Issues finished per day (UTC):')
	})
})
