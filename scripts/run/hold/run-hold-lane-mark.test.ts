import path from 'node:path'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { describe, expect, it } from 'vitest'
import { run_hold } from './run-hold'

const ISSUE = '7653'
const OTHER_ISSUE = '7000'
const LANE = path.join(path.sep, 'work', '.kit-lanes', ISSUE)
const MAIN = path.join(path.sep, 'work', 'kit')

describe('the mark of a hold taken in a lane', () => {
	it('marks a run that resumed the lane without being its dispatched child', () => {
		expect(run_hold.lane_mark(LANE, {})).toStrictEqual({ is_single_in_lane: true })
	})

	it('leaves the dispatched child of that lane unmarked', () => {
		const environment = { [lane_child_marker.KEY]: ISSUE }

		expect(run_hold.lane_mark(LANE, environment)).toStrictEqual({})
	})

	it('marks a lane whose child mark names another issue, a mark leaked from a parent', () => {
		const environment = { [lane_child_marker.KEY]: OTHER_ISSUE }

		expect(run_hold.lane_mark(LANE, environment)).toStrictEqual({ is_single_in_lane: true })
	})

	it('leaves a hold outside any lane unmarked', () => {
		expect(run_hold.lane_mark(MAIN, {})).toStrictEqual({})
	})
})
