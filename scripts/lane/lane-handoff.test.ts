import { git_common_directory } from '#scripts/git/git-common-directory'
import { run_carry } from '#scripts/run/carry/run-carry'
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

// joshuafolkken/kit#4245: the same reading for a caller that must not block, starting no process.
function read_start(): string | undefined {
	return undefined
}

describe('lane_handoff.ship_reader', () => {
	it('reads the repository once, asynchronously, and each issue through the start reader given', async () => {
		const repository = vi.spyOn(git_common_directory, 'repository')
		const directory = vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
		const read = vi
			.spyOn(run_ship_detach, 'read_result')
			.mockReturnValue({ launch_id: 'launch', result: 'running' })

		const is_shipping = await lane_handoff.ship_reader(read_start)

		expect([is_shipping(ISSUE), is_shipping('2963')]).toEqual([true, true])
		expect(read).toHaveBeenCalledWith(REPOSITORY, ISSUE, read_start)
		expect(directory).toHaveBeenCalledTimes(1)
		expect(repository).not.toHaveBeenCalled()
	})

	it('reads a ship that is not running as not running', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(REPOSITORY)
		vi.spyOn(run_ship_detach, 'read_result').mockReturnValue({ launch_id: 'l', result: 'failed' })

		expect((await lane_handoff.ship_reader(read_start))(ISSUE)).toBe(false)
	})

	it('reads nothing as running where the repository could not be read', async () => {
		vi.spyOn(run_carry, 'repository_directory').mockRejectedValue(new Error('not a repository'))
		const read = vi.spyOn(run_ship_detach, 'read_result')

		expect((await lane_handoff.ship_reader(read_start))(ISSUE)).toBe(false)
		expect(read).not.toHaveBeenCalled()
	})
})

describe('lane_handoff.ship_running_since', () => {
	const LAUNCHED_AT = 1000

	it('reads the running ship launch time from the checkout repository', () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(REPOSITORY)
		const since = vi.spyOn(run_ship_detach, 'running_since').mockReturnValue(LAUNCHED_AT)

		expect(lane_handoff.ship_running_since(ISSUE, DIRECTORY)).toBe(LAUNCHED_AT)
		expect(since).toHaveBeenCalledWith(REPOSITORY, ISSUE)
	})

	it('reads a directory outside a repository as no running ship', () => {
		vi.spyOn(git_common_directory, 'repository').mockReturnValue(undefined)

		expect(lane_handoff.ship_running_since(ISSUE, DIRECTORY)).toBeUndefined()
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
