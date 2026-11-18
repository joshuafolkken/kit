import { lane_host_gaps } from '#scripts/lane/lane-host-gaps'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#7905: the usual times are read net of the host's stops on the whole stream.

const { AFTER, ENDED_AT, INSIDE, arrange } = run_board_read_fixture
const MINUTE_MS = 60_000
const STARTED_AT = '2026-10-08T09:00:00.000Z'
const ENDED_RUN = {
	invocation: 'backlogrun #3431 --only',
	started_at: STARTED_AT,
	ended_at: ENDED_AT,
}
const DISPATCHED: LedgerEntry = { kind: 'dispatch', at: STARTED_AT, issue: 1 }
// Ten minutes after dispatch, the first ship stage ends a minute long: nine minutes of implementation.
const PREFLIGHT: LedgerEntry = {
	kind: 'stage',
	at: '2026-10-08T09:10:00.000Z',
	stage: 'preflight',
	elapsed_ms: MINUTE_MS,
	issue: 1,
}
// Two minutes the host slept inside the implementation.
const SLEEP = {
	from_ms: Date.parse('2026-10-08T09:02:00.000Z'),
	to_ms: Date.parse('2026-10-08T09:04:00.000Z'),
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_read.read_local usual times net of the host stops', () => {
	it('takes the stops on the whole stream out of the usual implementation', async () => {
		arrange({ kind: 'none' }, ENDED_RUN)
		vi.spyOn(lane_ledger, 'read_entries').mockReturnValue([DISPATCHED, PREFLIGHT])
		const gaps_of = vi.spyOn(lane_host_gaps, 'gaps_of').mockReturnValue([SLEEP])
		const read = await run_board_read.read_local()

		expect(read?.usual?.get('implement')).toBe(7 * MINUTE_MS)
		expect(gaps_of).toHaveBeenCalledWith([INSIDE, AFTER])
	})
})
