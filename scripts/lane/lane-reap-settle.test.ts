import { userInfo } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { lane_reap_settle, type SettleProbes } from './lane-reap-settle'

// joshuafolkken/kit#4300: a SIGTERM is a request, so the close looks again — whatever is still in the
// lane's directory after the grace window gets a SIGKILL, and what outlives that is reported with why.

const { GRACE_MS, KILL_WAIT_MS, reason_from, settle, survivor_texts } = lane_reap_settle
const LANE = { issue: '4300', directory: '/w/.kit-lanes/4300' }
const RESIDENT = 20_611
const REASON = 'owned by root'

// `residents` answers each reading in turn, the last one repeated.
function probes_over(readings: Array<Array<number> | undefined>): SettleProbes {
	const pending = [...readings]

	return {
		residents: () => (pending.length > 1 ? pending.shift() : pending[0]),
		kill: vi.fn(() => true),
		wait: vi.fn(async () => {
			await Promise.resolve()
		}),
		reason_of: () => REASON,
	}
}

describe('lane_reap_settle.settle', () => {
	it('answers nothing and does not wait when no process is in the lane', async () => {
		const probes = probes_over([[]])

		await expect(settle(LANE, probes)).resolves.toStrictEqual([])
		expect(probes.wait).not.toHaveBeenCalled()
	})

	it('sends no SIGKILL when the resident went within the grace window', async () => {
		const probes = probes_over([[RESIDENT], []])

		await expect(settle(LANE, probes)).resolves.toStrictEqual([])
		expect(probes.wait).toHaveBeenCalledWith(GRACE_MS)
		expect(probes.kill).not.toHaveBeenCalled()
	})

	it('kills a lingering resident and answers nothing once it went', async () => {
		const probes = probes_over([[RESIDENT], [RESIDENT], []])

		await expect(settle(LANE, probes)).resolves.toStrictEqual([])
		expect(probes.kill).toHaveBeenCalledWith(RESIDENT)
		expect(probes.wait).toHaveBeenLastCalledWith(KILL_WAIT_MS)
	})

	it('answers a resident that outlived the SIGKILL with why', async () => {
		const probes = probes_over([[RESIDENT]])

		await expect(settle(LANE, probes)).resolves.toStrictEqual([{ pid: RESIDENT, reason: REASON }])
	})

	it('reads a failed reading again rather than as no process', async () => {
		const probes = probes_over([undefined, [RESIDENT], []])

		await expect(settle(LANE, probes)).resolves.toStrictEqual([])
		expect(probes.kill).toHaveBeenCalledWith(RESIDENT)
	})

	it('kills nothing on a failed reading and answers a last one that failed as unread', async () => {
		const probes = probes_over([[RESIDENT], undefined])

		await expect(settle(LANE, probes)).resolves.toBeUndefined()
		expect(probes.kill).not.toHaveBeenCalled()
	})
})

describe('lane_reap_settle.survivor_texts', () => {
	it('names each process and why it survived', () => {
		expect(survivor_texts([{ pid: RESIDENT, reason: REASON }])).toStrictEqual([
			'process 20611 (owned by root)',
		])
	})

	it('names a failed reading as such', () => {
		expect(survivor_texts(undefined)).toStrictEqual(["the lane's processes (lsof or ps failed)"])
	})
})

describe('lane_reap_settle.reason_from', () => {
	it('names the owner of a process another account owns', () => {
		expect(reason_from('root', 'Ss')).toBe(REASON)
	})

	it('names the state of a process this account owns', () => {
		expect(reason_from(userInfo().username, 'U')).toBe('state U')
	})
})
