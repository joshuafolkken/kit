import type { RunCarry } from '#scripts/run/carry/run-carry'
import { describe, expect, it } from 'vitest'
import { backlog_drive, type DriveState } from './backlog-drive'
import { backlog_drive_offer_argv } from './backlog-drive-offer-argv'

const STARTED_AT = '2026-11-09T00:00:00.000Z'
const CHILD = '6871'
const CARRY: RunCarry = {
	invocation: 'backlogrun',
	started_at: STARTED_AT,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}

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
})
