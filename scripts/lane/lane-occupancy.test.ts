import { describe, expect, it } from 'vitest'
import { lane_occupancy, type LaneRead } from './lane-occupancy'

// joshuafolkken/kit#2235: the difference between the `in-progress` issues and the open lanes, in
// both directions, with the lane liveness read three-valued so an unreadable listing stays `unknown`
// rather than being reported as a stopped lane.

function lanes(...issues: ReadonlyArray<number>): LaneRead {
	return { kind: 'lanes', issues }
}

const UNREADABLE: LaneRead = { kind: 'unreadable' }

describe('classify names the difference in both directions', () => {
	it('marks an in-progress issue with an open lane as live', () => {
		const report = lane_occupancy.classify([1], lanes(1))

		expect(report.labelled).toEqual([{ issue: 1, liveness: 'live' }])
		expect(report.lanes_without_label).toEqual([])
	})

	it('marks an in-progress issue with no lane as stopped', () => {
		const report = lane_occupancy.classify([1], lanes(2))

		expect(report.labelled).toEqual([{ issue: 1, liveness: 'stopped' }])
	})

	it('names a lane whose issue carries no in-progress label', () => {
		const report = lane_occupancy.classify([1], lanes(1, 2))

		expect(report.lanes_without_label).toEqual([2])
	})
})

describe('classify collapses nothing when the two sets agree', () => {
	it('reports every issue live and no orphan lane', () => {
		const report = lane_occupancy.classify([1, 2], lanes(1, 2))

		expect(report.labelled.every((entry) => entry.liveness === 'live')).toBe(true)
		expect(report.lanes_without_label).toEqual([])
	})

	it('describes nothing to report', () => {
		const report = lane_occupancy.classify([1], lanes(1))

		expect(lane_occupancy.describe(report)).toBeUndefined()
	})
})

describe('an unreadable lane listing stays unknown, never stopped', () => {
	const report = lane_occupancy.classify([1, 2], UNREADABLE)

	it('marks every in-progress issue unknown', () => {
		expect(report.labelled).toEqual([
			{ issue: 1, liveness: 'unknown' },
			{ issue: 2, liveness: 'unknown' },
		])
	})

	it('names no orphan lane, since there is nothing to compare against', () => {
		expect(report.lanes_without_label).toEqual([])
	})
})

describe('describe reports the anomalies', () => {
	it('names a stopped issue and an orphan lane', () => {
		const report = lane_occupancy.classify([1], lanes(2))
		const described = lane_occupancy.describe(report)

		expect(described).toContain('#1')
		expect(described).toContain('#2')
	})

	it('leads a stopped line with the stopped verdict token', () => {
		const described = lane_occupancy.describe(lane_occupancy.classify([1], lanes(2)))

		expect(described).toContain(lane_occupancy.STOPPED)
	})

	it('leads an unknown line with the unknown verdict token', () => {
		const described = lane_occupancy.describe(lane_occupancy.classify([1], UNREADABLE))

		expect(described).toContain(lane_occupancy.UNKNOWN)
	})
})
