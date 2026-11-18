import type { CarryRead } from '#scripts/run/carry/run-carry'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'
import { run_board_records } from './run-board-records'

const { ENDED_AT, arrange } = run_board_read_fixture
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const NONE: CarryRead = { kind: 'none' }
const EPIC_RUN = 'backlogrun #3431 --only'
const STUCK_PID = 20_611
const STUCK_REASON = 'owned by root'

afterEach(() => vi.restoreAllMocks())

// joshuafolkken/kit#4300: a process a close could not end is named on the board with why, until a
// retried close ends its lane.
describe('run_board_read.read_local — the processes a close could not end', () => {
	it('reads them off the records of the lanes not yet ended', async () => {
		arrange(NONE, { invocation: EPIC_RUN, started_at: STARTED_AT, ended_at: ENDED_AT })
		const stuck = [{ pid: STUCK_PID, reason: STUCK_REASON }]
		const record = { issue: '3433', changed_at: STARTED_AT, changed_by: 'lane:open', stuck }

		vi.mocked(run_board_records.read_records).mockReturnValue([
			{ ...record, state: 'open' },
			{ ...record, issue: '3434', state: 'ended', stuck: [{ pid: 1, reason: 'gone' }] },
		])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			closing: new Set(['3433']),
			stuck: new Map([[STUCK_PID, STUCK_REASON]]),
		})
	})
})
