import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_read } from './run-board-read'
import { run_board_read_fixture } from './run-board-read-fixture'

// joshuafolkken/kit#6538: the ledger's open hold, in its own words, explains an empty lane seat until
// it is released.

const { CARRY, ENDED_AT, INSIDE, arrange } = run_board_read_fixture
const REASON = 'offer:wait:blocked'
const HOLD: LedgerEntry = { kind: 'held', at: '2026-10-08T09:00:00.000Z', reason: REASON }

afterEach(() => {
	vi.restoreAllMocks()
})

function arrange_ledger(entries: ReadonlyArray<LedgerEntry>): void {
	arrange({ kind: 'carried', carry: CARRY }, undefined)
	vi.spyOn(lane_ledger, 'read_entries').mockReturnValue(entries)
	// Inside the hold's cap, so the open hold is not read as a driver killed while held.
	vi.spyOn(Date, 'now').mockReturnValue(Date.parse(INSIDE.at))
}

describe('run_board_read.read_local launch hold', () => {
	it('keeps the open hold’s reason while it lasts', async () => {
		arrange_ledger([HOLD])

		await expect(run_board_read.read_local()).resolves.toMatchObject({
			launch_hold: REASON,
			is_memory_held: false,
		})
	})

	// joshuafolkken/kit#7121: a lane freed after a full driver's hand-back holds by the mark's reason.
	it('keeps a hand-back hold written after the driver’s release', async () => {
		const reason = 'hand-back:window'

		arrange_ledger([
			{ kind: 'released', at: '2026-10-08T08:59:00.000Z' },
			{ ...HOLD, reason },
		])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ launch_hold: reason })
	})

	it('drops the reason once a dispatch released the hold', async () => {
		arrange_ledger([HOLD, { kind: 'dispatch', at: ENDED_AT, issue: 1 }])

		await expect(run_board_read.read_local()).resolves.toMatchObject({ launch_hold: undefined })
	})
})
