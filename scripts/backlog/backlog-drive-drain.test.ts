import { describe, expect, it } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'

const { CONFIG, harness, offer, state } = backlog_drive_fixture
const UNIT_CALL = 'retrospective unit'
const FINISH_CALL = 'finish'
const EXHAUSTED = 'exhausted'

// joshuafolkken/kit#6745: the driver runs the retrospective unit itself; only a failed unit hands it back.
describe('backlog_drive.run_loop — a drained stop that owes the retrospective', () => {
	const drained = { ...offer('stop'), answer: EXHAUSTED, is_retrospective_owed: true }

	it('runs one retrospective unit and ends the stop without handing it back', async () => {
		const { ports, calls } = harness({ offers: [drained] })
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(end.reason).toBe('stop')
		expect(calls.filter((call) => call === UNIT_CALL)).toHaveLength(1)
		expect(calls).toContain(FINISH_CALL)
	})

	it('hands the retrospective back before ending the carry when the unit fails', async () => {
		const { ports, calls } = harness({ offers: [drained], retrospective: false })
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(end.reason).toBe('retrospective')
		expect(calls).toContain(UNIT_CALL)
		expect(calls).not.toContain(FINISH_CALL)
	})
})

describe('backlog_drive.run_loop — a drained stop that owes no retrospective', () => {
	it('ends the stop without handing it back or running a unit', async () => {
		const { ports, calls } = harness({ offers: [{ ...offer('stop'), answer: EXHAUSTED }] })
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(end.reason).toBe('stop')
		expect(calls).toContain(FINISH_CALL)
		expect(calls).not.toContain(UNIT_CALL)
	})

	it('runs no unit at a drained watch, which stays the parent’s', async () => {
		const owed = { ...offer('watch'), answer: EXHAUSTED, is_retrospective_owed: true }
		const { ports, calls } = harness({ offers: [owed] })
		const end = await backlog_drive.run_loop(state(), CONFIG, ports)

		expect(end.reason).toBe('watch')
		expect(calls).not.toContain(UNIT_CALL)
	})
})
