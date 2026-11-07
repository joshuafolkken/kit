import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { FIRST_CHILD, OFFERED, harness, offer, state } = backlog_drive_fixture

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
