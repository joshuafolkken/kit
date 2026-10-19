import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_child_invocation } from './lane-child-invocation'
import { lane_paused, type PausedProbes } from './lane-paused'
import { lane_reap } from './lane-reap'

// joshuafolkken/kit#4201: the lane limit leaves a paused lane uncounted, read the way `run:board`
// draws one `paused` (#4198).

const ISSUE = '4173'
const PIDS = [15_712, 51_899]
const CHILD_PID = 60_001

function probes(states: Array<string>, pids: Array<number> = PIDS): PausedProbes {
	return {
		matching: () => pids,
		children_of: () => [],
		parent_of: () => undefined,
		states_of: () => states,
	}
}

function children_of(pid: number): Array<number> {
	return pid === PIDS[0] ? [CHILD_PID] : []
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('lane_paused.is_paused', () => {
	it.each([[['T']], [['TN', 'TNs']], [['TN', 'Z']]])('reads %j as paused', (stats) => {
		expect(lane_paused.is_paused(stats)).toBe(true)
	})

	it.each([[['S']], [['R']], [['TN', 'RN']], [['Z']], [[]]])('reads %j as not paused', (stats) => {
		expect(lane_paused.is_paused(stats)).toBe(false)
	})
})

describe('lane_paused.is_lane_paused', () => {
	it('answers yes when every matched process is stopped', () => {
		expect(lane_paused.is_lane_paused(ISSUE, probes(['TNs', 'TN']))).toBe(true)
	})

	it('answers no when one matched process still runs', () => {
		expect(lane_paused.is_lane_paused(ISSUE, probes(['TNs', 'SN']))).toBe(false)
	})

	it('answers no when the states could not be read', () => {
		expect(lane_paused.is_lane_paused(ISSUE, probes([]))).toBe(false)
	})

	it('answers no and reads no state when nothing matches', () => {
		const states_of = vi.fn<PausedProbes['states_of']>(() => ['T'])

		expect(lane_paused.is_lane_paused(ISSUE, { ...probes([], []), states_of })).toBe(false)
		expect(states_of).not.toHaveBeenCalled()
	})

	it('matches the lane by the pattern `lane:await` probes with, and reads every pid', () => {
		const matching = vi.fn<PausedProbes['matching']>(() => PIDS)
		const states_of = vi.fn<PausedProbes['states_of']>(() => ['T', 'T'])

		lane_paused.is_lane_paused(ISSUE, { ...probes([]), matching, states_of })

		expect(matching).toHaveBeenCalledWith(lane_child_invocation.process_pattern(ISSUE))
		expect(states_of).toHaveBeenCalledWith(PIDS)
	})

	it('reads the descendants too, so a stopped child whose subprocess runs is not paused', () => {
		const states_of = vi.fn<PausedProbes['states_of']>(() => ['T', 'R'])
		const tree_probes = { ...probes([], [PIDS[0] ?? 0]), children_of, states_of }

		expect(lane_paused.is_lane_paused(ISSUE, tree_probes)).toBe(false)
		expect(states_of).toHaveBeenCalledWith([PIDS[0], CHILD_PID])
	})
})

describe('lane_paused.states_of', () => {
	it('asks one `ps` for every pid and reads each trimmed state', () => {
		const run_probe = vi.spyOn(lane_reap, 'run_probe').mockReturnValue(' TN\nTNs \n\n')

		expect(lane_paused.states_of(PIDS)).toEqual(['TN', 'TNs'])
		expect(run_probe).toHaveBeenCalledWith(lane_reap.PS_COMMAND, [
			'-o',
			'stat=',
			'-p',
			PIDS.join(','),
		])
	})

	it('reads a failed `ps` as no states', () => {
		vi.spyOn(lane_reap, 'run_probe').mockReturnValue('')

		expect(lane_paused.states_of(PIDS)).toEqual([])
	})
})
