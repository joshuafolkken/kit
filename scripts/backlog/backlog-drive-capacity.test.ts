import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { CONFIG, FIRST_CHILD, OFFERED, POLL_MS, harness, offer, state } = backlog_drive_fixture
const WATCHED_POLLS = 3

describe('backlog_drive.run_pass — offer capacity', () => {
	it('asks the offer on the next pass when a lane becomes free', async () => {
		const offered = offer('run', [OFFERED])
		const script = { offers: [offered], free_lanes: [0, 1], limit_room: [1] }
		const { ports, calls } = harness(script)
		const first = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toStrictEqual([])
		await backlog_drive.run_pass(first.state, true, ports)

		expect(calls).toStrictEqual(['offer', `launch ${OFFERED}`])
	})

	it('collects a finished child without asking the offer while the pool remains full', async () => {
		const { ports, calls } = harness({ finished: [FIRST_CHILD], free_lanes: [0] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`])
		expect(result.kind).toBe('continue')
		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
	})
})

// A full pool skips the offer, so a passed deadline stays in the state; the loop must still poll at
// `poll_ms` instead of spinning on sleep(0).
describe('backlog_drive.run_loop — a passed deadline while the pool is full', () => {
	it.each([
		['not_before_ms alone', { not_before_ms: -1 }],
		['an earlier idle_until_ms', { not_before_ms: CONFIG.offer_ms, idle_until_ms: -1 }],
	])('waits the normal poll interval with %s', async (_label, offsets) => {
		const { ports, calls } = harness({ free_lanes: [0] })
		const now_ms = ports.now().getTime()
		const deadlines = Object.fromEntries(
			Object.entries(offsets).map(([key, offset]) => [key, now_ms + offset]),
		)
		const slept: Array<number> = []

		async function sleep(milliseconds: number): Promise<void> {
			if (milliseconds <= 0) throw new Error(`sleep(${String(milliseconds)}) would spin`)
			slept.push(milliseconds)
			await ports.sleep(milliseconds)
		}

		const config = { ...CONFIG, window_ms: POLL_MS * WATCHED_POLLS }

		await backlog_drive.run_loop({ ...state([FIRST_CHILD]), ...deadlines }, config, {
			...ports,
			sleep,
		})

		expect(slept).toStrictEqual(Array.from({ length: WATCHED_POLLS }, () => POLL_MS))
		expect(calls).toStrictEqual([])
	})
})
