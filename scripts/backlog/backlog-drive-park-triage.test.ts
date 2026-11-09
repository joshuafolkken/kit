import { describe, expect, it } from 'vitest'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_park_triage } from './backlog-drive-park-triage'

const { FIRST_CHILD, state } = backlog_drive_fixture

function owed(in_flight: ReadonlyArray<string>, is_stopping = false): ReturnType<typeof state> {
	return { ...state(in_flight), is_triage_owed: true, is_stopping }
}

describe('backlog_drive_park_triage.hand_back', () => {
	it('ends with triage and clears the owed flag', () => {
		const result = backlog_drive_park_triage.hand_back(owed([FIRST_CHILD]))

		expect(result?.kind === 'end' && result.end).toStrictEqual({
			reason: 'triage',
			token: 'triage',
			issue: undefined,
		})
		expect(result?.state.is_triage_owed).toBe(false)
	})

	it('owes nothing while the run is stopping', () => {
		expect(backlog_drive_park_triage.hand_back(owed([FIRST_CHILD], true))).toBeUndefined()
	})

	it('owes nothing without a park', () => {
		expect(backlog_drive_park_triage.hand_back(state([FIRST_CHILD]))).toBeUndefined()
	})
})

describe('backlog_drive_park_triage.triaged', () => {
	it('keeps a pass that already ended', () => {
		const ended = {
			kind: 'end' as const,
			end: { reason: 'launch', token: undefined, issue: undefined },
			state: owed([]),
		}

		expect(backlog_drive_park_triage.triaged(ended, true)).toBe(ended)
	})
})

describe('backlog_drive_park_triage.is_drain_park', () => {
	it('is a drain park only when the park left nothing in flight', () => {
		expect(backlog_drive_park_triage.is_drain_park(owed([]))).toBe(true)
		expect(backlog_drive_park_triage.is_drain_park(owed([FIRST_CHILD]))).toBe(false)
		expect(backlog_drive_park_triage.is_drain_park(state([]))).toBe(false)
	})
})
