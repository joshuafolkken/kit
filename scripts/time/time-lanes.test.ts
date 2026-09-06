import { describe, expect, it } from 'vitest'
import { time_lanes, type LaneRun } from './time-lanes'

// Lanes derived from wall clock rather than from a field nothing writes (joshuafolkken/kit#1470).
// The cases are about the two answers the derivation has to get right: one lane when nothing
// overlapped — the honest reading of a backlog worked serially — and the peak concurrency when
// something did.

const MINUTE_MS = 60_000
const ISSUE_A = 11
const ISSUE_B = 22
const ISSUE_C = 33

function run(issue: number, start_minute: number, end_minute: number): LaneRun {
	return { issue, started_ms: start_minute * MINUTE_MS, ended_ms: end_minute * MINUTE_MS }
}

// Two runs that never share a minute, and two that share half of one.
const SERIAL = [run(ISSUE_A, 0, 10), run(ISSUE_B, 10, 20)]
const OVERLAPPING = [run(ISSUE_A, 0, 20), run(ISSUE_B, 10, 30)]

function issues_of(lanes: ReadonlyArray<{ runs: ReadonlyArray<LaneRun> }>): Array<Array<number>> {
	return lanes.map((lane) => lane.runs.map((one) => one.issue))
}

describe('time_lanes.assign_lanes', () => {
	it('keeps runs that never overlap in one lane', () => {
		const lanes = time_lanes.assign_lanes(SERIAL)

		expect(issues_of(lanes)).toStrictEqual([[ISSUE_A, ISSUE_B]])
		expect(lanes[0]?.busy_ms).toBe(20 * MINUTE_MS)
	})

	it('opens a second lane for a run that started before the first one ended', () => {
		expect(issues_of(time_lanes.assign_lanes(OVERLAPPING))).toStrictEqual([[ISSUE_A], [ISSUE_B]])
	})

	it('reuses a lane that has fallen free rather than opening a third', () => {
		const runs = [...OVERLAPPING, run(ISSUE_C, 25, 40)]

		expect(issues_of(time_lanes.assign_lanes(runs))).toStrictEqual([[ISSUE_A, ISSUE_C], [ISSUE_B]])
	})
})

describe('time_lanes.serial_intervals', () => {
	it('reports nothing while only one lane was ever busy', () => {
		expect(time_lanes.serial_intervals(SERIAL, 1)).toStrictEqual([])
	})

	it('names the run that held the only busy lane', () => {
		const intervals = time_lanes.serial_intervals(OVERLAPPING, 2)

		expect(intervals).toStrictEqual([
			{ started_ms: 0, ended_ms: 10 * MINUTE_MS, issue: ISSUE_A },
			{ started_ms: 20 * MINUTE_MS, ended_ms: 30 * MINUTE_MS, issue: ISSUE_B },
		])
	})

	it('keeps the stretches a run held apart when another run ran between them', () => {
		const runs = [run(ISSUE_A, 0, 30), run(ISSUE_B, 5, 10), run(ISSUE_C, 15, 20)]
		const held = time_lanes.serial_intervals(runs, 2).filter((one) => one.issue === ISSUE_A)

		expect(held).toHaveLength(3)
	})

	// The peak concurrency is a property of the whole window: one overlapping pair anywhere in it used
	// to make every lone run elsewhere read as a stretch "held while the others waited", when nothing
	// was waiting at all.
	it('ignores a run that stood alone, far from any overlap', () => {
		const runs = [...OVERLAPPING, run(ISSUE_C, 1000, 1100)]
		const intervals = time_lanes.serial_intervals(runs, 2)

		expect(intervals.map((one) => one.issue)).toStrictEqual([ISSUE_A, ISSUE_B])
	})

	// A run that started and ended in the same instant cuts the window without ever being in flight,
	// so nothing it bounds was beside other work.
	it('ignores the stretches an instant run cut, since it was never in flight', () => {
		expect(
			time_lanes.serial_intervals([run(ISSUE_A, 0, 30), run(ISSUE_B, 10, 10)], 2),
		).toStrictEqual([])
	})
})

describe('time_lanes.exposure_of', () => {
	it('counts every wait as exposed when nothing else was running', () => {
		expect(time_lanes.exposure_of(SERIAL)).toStrictEqual({
			hidden_ms: 0,
			exposed_ms: 20 * MINUTE_MS,
		})
	})

	it('counts the overlapped wall clock as hidden behind the other run', () => {
		expect(time_lanes.exposure_of(OVERLAPPING)).toStrictEqual({
			hidden_ms: 20 * MINUTE_MS,
			exposed_ms: 20 * MINUTE_MS,
		})
	})
})

describe('time_lanes.span_of', () => {
	it('has no span for no runs at all', () => {
		expect(time_lanes.span_of([])).toBeUndefined()
	})

	it('runs from the first start to the last end', () => {
		expect(time_lanes.span_of(OVERLAPPING)).toStrictEqual({
			started_ms: 0,
			ended_ms: 30 * MINUTE_MS,
		})
	})
})
