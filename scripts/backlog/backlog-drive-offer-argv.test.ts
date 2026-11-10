import { process_identity } from '#scripts/josh/process-identity'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_offer_argv } from './backlog-drive-offer-argv'

const STARTED_AT = '2026-11-09T00:00:00.000Z'
const CHILD = '6871'
const TRIAGE_PID = 4242
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

afterEach(() => {
	vi.restoreAllMocks()
})

function running_of(state: DriveState): string | undefined {
	const argv = backlog_drive_offer_argv.offer_argv(state, CARRY, [])

	return argv[argv.indexOf('--running') + 1]
}

// joshuafolkken/kit#6871: a park owing triage counts as running, so an empty pool reads `blocked`, not
// the drain that owes the retrospective ahead of the triage.
describe('backlog_drive_offer_argv — --running', () => {
	it('counts the children in flight', () => {
		const state = backlog_drive.initial_state([CHILD], STARTED_AT)

		expect(running_of(state)).toBe('1')
	})

	it('counts a park owing triage as one more running child', () => {
		const state = { ...backlog_drive.initial_state([CHILD], STARTED_AT), is_triage_owed: true }

		expect(running_of(state)).toBe('2')
	})

	it('does not count the park once the run is stopping', () => {
		const state = {
			...backlog_drive.initial_state([], STARTED_AT),
			is_triage_owed: true,
			is_stopping: true,
		}

		expect(running_of(state)).toBe('0')
	})

	// joshuafolkken/kit#7120: the park waits for the triage session beside the driver.
	it('does not count the park while a triage session runs beside the driver', () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		const state = {
			...backlog_drive.initial_state([CHILD], STARTED_AT),
			is_triage_owed: true,
			triage_pid: TRIAGE_PID,
		}

		expect(running_of(state)).toBe('1')
	})
})
