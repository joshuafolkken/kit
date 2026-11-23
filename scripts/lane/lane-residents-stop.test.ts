import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_reap } from './lane-reap'
import { lane_residents, type ResidentProbes } from './lane-residents'

const LANE = '/w/.kit-lanes/42'
const SUBJECT = { issue: '42', directory: LANE }
const CHILD = 48_848
const RESIDENT = 66_330
const OWN = 60_000
const MACHINE = new Map([
	[CHILD, LANE],
	[RESIDENT, LANE],
	[OWN, LANE],
])

function probes_over(signalled: Array<number>): ResidentProbes {
	return {
		directories: () => MACHINE,
		marks: () => new Map(),
		own: () => new Set([OWN]),
		groups_of: (pids) => new Map(pids.map((pid) => [pid, pid])),
		terminate: (pid) => {
			signalled.push(pid)

			return true
		},
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#8843: `lane:restart` and a relaunch share one stop — the child, then what it left.
describe('lane_residents.stop_child', () => {
	it('ends the lane’s residents once the child was reaped, sparing the child', () => {
		const signalled: Array<number> = []

		vi.spyOn(lane_reap, 'reap_child').mockReturnValue([CHILD])
		vi.spyOn(console, 'error').mockReturnValue()

		expect(lane_residents.stop_child(SUBJECT, '#42', probes_over(signalled))).toStrictEqual([CHILD])
		expect(signalled).toStrictEqual([RESIDENT])
	})

	it('ends nothing else when no child ran', () => {
		const signalled: Array<number> = []

		vi.spyOn(lane_reap, 'reap_child').mockReturnValue([])

		expect(lane_residents.stop_child(SUBJECT, '#42', probes_over(signalled))).toStrictEqual([])
		expect(signalled).toStrictEqual([])
	})
})
