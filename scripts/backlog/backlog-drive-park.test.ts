import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { FIRST_CHILD, SECOND_CHILD, harness, offer, state } = backlog_drive_fixture

// joshuafolkken/kit#3041: a parked child stayed excluded for the rest of the driver's process, so one a
// person released from `needs-decision` was never offered again until the driver restarted.
describe('backlog_drive — a parked child is not excluded', () => {
	it('leaves a child run:merge parked out of the exclude list', async () => {
		const { ports, offers } = harness({ finished: [FIRST_CHILD], parked: [FIRST_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)

		expect(offers[0]?.exclude).toStrictEqual([])
		expect(result.state.exclude).toStrictEqual([])
		expect(result.kind === 'continue' && result.state.in_flight).toStrictEqual([])
	})

	it('still excludes a merged child beside a parked one', async () => {
		const { ports } = harness({ finished: [FIRST_CHILD, SECOND_CHILD], parked: [SECOND_CHILD] })
		const result = await backlog_drive.run_pass(state([FIRST_CHILD, SECOND_CHILD]), false, ports)

		expect(result.state.exclude).toStrictEqual([FIRST_CHILD])
	})

	it('launches a parked child again once a later offer returns it', async () => {
		const { ports, calls, offers } = harness({
			finished: [FIRST_CHILD],
			parked: [FIRST_CHILD],
			offers: [offer('wait'), offer('run', [FIRST_CHILD])],
		})
		const parked = await backlog_drive.run_pass(state([FIRST_CHILD]), false, ports)
		const released = await backlog_drive.run_pass(parked.state, true, ports)

		expect(calls).toStrictEqual([`merge ${FIRST_CHILD}`, 'offer', 'offer', `launch ${FIRST_CHILD}`])
		expect(offers[1]?.exclude).toStrictEqual([])
		expect(released.kind === 'continue' && released.state.in_flight).toStrictEqual([FIRST_CHILD])
	})
})
