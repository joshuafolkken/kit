import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

// joshuafolkken/kit#4621: an offered issue its measurement declaration closed takes no lane — it is not
// in flight, it is excluded from the run's later offers, and the next offered issue still launches.
const { ACTIVE, OFFERED, OFFERED_TOO, harness, offer, state } = backlog_drive_fixture
const EARLIER = '2026-09-23T00:00:00.000Z'

describe('backlog_drive.run_pass — a measured close', () => {
	it('keeps the measured issue out of flight and out of later offers', async () => {
		const { ports, calls } = harness({
			offers: [offer('run', [OFFERED, OFFERED_TOO])],
			measured_launches: [OFFERED],
		})
		const result = await backlog_drive.run_pass(state(), true, ports)

		expect(calls).toContain(`launch ${OFFERED}`)
		expect(result.state.in_flight).toStrictEqual([OFFERED_TOO])
		expect(result.state.exclude).toStrictEqual([OFFERED])
	})

	it('counts a measured close alone as activity', async () => {
		const { ports } = harness({
			offers: [offer('run', [OFFERED])],
			measured_launches: [OFFERED],
		})
		const result = await backlog_drive.run_pass(
			backlog_drive.initial_state([], EARLIER),
			true,
			ports,
		)

		expect(result.kind).toBe('continue')
		expect(result.state.in_flight).toStrictEqual([])
		expect(result.state.active).toBe(ACTIVE)
	})
})
