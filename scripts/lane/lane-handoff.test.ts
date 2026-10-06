import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_child_marker } from './lane-child-marker'
import { lane_handoff } from './lane-handoff'

// joshuafolkken/kit#2962: the one reading both stop hooks share — a lane child is handed off only while
// its own detached ship is live.

const ISSUE = '2962'
const DIRECTORY = '/repo/.kit-lanes/2962'
const REPOSITORY = '/repo/.git'
const CHILD_SOURCE = { [lane_child_marker.KEY]: ISSUE }

type ShipResult = NonNullable<ReturnType<typeof run_ship_detach.read_result>>['result']

function ship_reads(result: ShipResult | undefined): void {
	vi.spyOn(git_common_directory, 'repository').mockReturnValue(REPOSITORY)
	vi.spyOn(run_ship_detach, 'read_result').mockReturnValue(
		result === undefined ? undefined : { launch_id: 'launch', result },
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_handoff.is_ship_running', () => {
	it('reads a live supervisor in the checkout repository as running', () => {
		ship_reads('running')

		expect(lane_handoff.is_ship_running(ISSUE, DIRECTORY)).toBe(true)
		expect(run_ship_detach.read_result).toHaveBeenCalledWith(REPOSITORY, ISSUE)
	})

	it.each<[ShipResult | undefined]>([['failed'], ['success'], ['abnormal'], [undefined]])(
		'reads a ship record of %j as not running',
		(result) => {
			ship_reads(result)

			expect(lane_handoff.is_ship_running(ISSUE, DIRECTORY)).toBe(false)
		},
	)

	it('reads a directory outside a repository as not running', () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)
		const read = vi.spyOn(run_ship_detach, 'read_result')

		expect(lane_handoff.is_ship_running(ISSUE, DIRECTORY)).toBe(false)
		expect(read).not.toHaveBeenCalled()
	})
})

describe('lane_handoff.is_handed_off', () => {
	it('reads the lane child whose own ship is running as handed off', () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		ship_reads('running')

		expect(lane_handoff.is_handed_off(DIRECTORY, CHILD_SOURCE)).toBe(true)
	})

	it('reads a lane child whose ship failed back to it as not handed off', () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		ship_reads('failed')

		expect(lane_handoff.is_handed_off(DIRECTORY, CHILD_SOURCE)).toBe(false)
	})

	it('reads a session that is not this lane child as not handed off, without probing', () => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(false)
		ship_reads('running')

		expect(lane_handoff.is_handed_off(DIRECTORY, CHILD_SOURCE)).toBe(false)
		expect(run_ship_detach.read_result).not.toHaveBeenCalled()
	})

	it('reads a session with no dispatch mark as not handed off', () => {
		ship_reads('running')

		expect(lane_handoff.is_handed_off(DIRECTORY, {})).toBe(false)
	})
})
