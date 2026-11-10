import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_park_triage } from './backlog-drive-park-triage'

const { FIRST_CHILD, state } = backlog_drive_fixture
const TRIAGE_PID = 4242
const SESSION_START = 'Tue Nov 10 09:00:00 2026'

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

function beside(is_live: boolean): ReturnType<typeof state> {
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(is_live)

	return { ...owed([FIRST_CHILD]), triage_pid: TRIAGE_PID }
}

// joshuafolkken/kit#7120: while the triage session runs beside the driver, the park stays owed and
// every non-run answer is held.
describe('backlog_drive_park_triage — a triage session beside the driver', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('holds the pass and keeps the park owed while the session lives', () => {
		const result = backlog_drive_park_triage.hand_back(beside(true))

		expect(result?.kind).toBe('continue')
		expect(result?.state.is_triage_owed).toBe(true)
	})

	it('does not end a continuing pass with triage while the session lives', () => {
		const pass = { kind: 'continue' as const, state: beside(true) }

		expect(backlog_drive_park_triage.triaged(pass, true)).toBe(pass)
	})

	it('keeps a live session named on the state', () => {
		expect(backlog_drive_park_triage.settled(beside(true)).triage_pid).toBe(TRIAGE_PID)
	})

	it('drops a session that has ended and hands the owed triage back', () => {
		const settled = backlog_drive_park_triage.settled(beside(false))
		const result = backlog_drive_park_triage.hand_back(settled)

		expect(settled.triage_pid).toBeUndefined()
		expect(result?.kind === 'end' && result.end.token).toBe('triage')
	})

	it('drops a reissued pid whose start time is not the session it named', () => {
		const same = vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
		const reissued = { ...owed([FIRST_CHILD]), triage_pid: TRIAGE_PID, triage_start: SESSION_START }
		const settled = backlog_drive_park_triage.settled(reissued)

		expect(same).toHaveBeenCalledWith(TRIAGE_PID, SESSION_START)
		expect(settled).toMatchObject({ triage_pid: undefined, triage_start: undefined })
	})

	it('falls back to liveness on a platform that cannot read the start time', () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		const named = { ...owed([FIRST_CHILD]), triage_pid: TRIAGE_PID }

		expect(backlog_drive_park_triage.hand_back(named)?.kind).toBe('continue')
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
