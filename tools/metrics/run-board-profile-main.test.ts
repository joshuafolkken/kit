import { lane_ledger } from '#scripts/lane/lane-ledger'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_board_every } from '#scripts/run/board/run-board-every'
import { run_board_gather } from '#scripts/run/board/run-board-gather'
import { run_board_ledger_window } from '#scripts/run/board/run-board-ledger-window'
import { run_board_tick } from '#scripts/run/board/run-board-tick'
import { run_event_tail } from '#scripts/run/event/run-event-tail'
import { describe, expect, it, vi } from 'vitest'
import { run_board_profile } from './run-board-profile'
import { run_board_profile_main } from './run-board-profile-main'

const PER_SECOND = MS_PER_MINUTE / run_board_gather.MACHINE_SAMPLE_MS
const REPOSITORY = '/repository'

vi.mock(import('./run-board-profile'), async (import_original) => {
	const original = await import_original()

	return { run_board_profile: { ...original.run_board_profile, measure_all: vi.fn() } }
})

vi.mock(import('#scripts/run/event/run-event-tail'), () => ({
	run_event_tail: { read_events: vi.fn() },
}))

describe('run-board-profile-main', () => {
	it('measures nothing when it is imported rather than run', () => {
		expect(run_board_profile.measure_all).not.toHaveBeenCalled()
	})

	it('measures the lane records read and the throughput fold apart, once per local read', () => {
		vi.mocked(run_event_tail.read_events).mockReturnValue([])

		const pieces = run_board_profile_main.local_pieces(REPOSITORY)
		const shares = pieces.filter((piece) =>
			['lane records read', 'throughput fold'].includes(piece.label),
		)

		expect(shares.map((piece) => piece.per_minute)).toStrictEqual([
			MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS,
			MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS,
		])
	})
})

describe('run-board-profile-main redraw pieces (#8147)', () => {
	it('measures the redraw after new events and the record draws, one line each (ac-35eb33e6)', () => {
		const state = run_board_tick.FRESH_STATE
		const ports = { ...run_board_cli.LIVE_PORTS, gather: async () => state }
		const pieces = run_board_profile_main.redraw_pieces({ read: state, ports, state })

		expect(pieces.map((piece) => [piece.label, piece.per_minute])).toStrictEqual([
			['redraw', PER_SECOND],
			['redraw (new events)', MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS],
			['record (chat + once)', MS_PER_MINUTE / run_board_every.RECORD_EVERY_MS],
		])
	})
})

describe('run-board-profile-main round pieces (#8136)', () => {
	it('measures the budget waits, the quotas and the usages as parts of every round (ac-17c66d31)', () => {
		const pieces = run_board_profile_main.round_part_pieces()

		expect(pieces.map((piece) => [piece.label, piece.per_minute, piece.role])).toStrictEqual([
			['budget waits', PER_SECOND, 'part'],
			['quotas', PER_SECOND, 'part'],
			['usages', PER_SECOND, 'part'],
		])
	})

	it('measures the ledger read once per local read, as a share outside the round parts (ac-17c66d31)', () => {
		vi.mocked(run_event_tail.read_events).mockReturnValue([])

		const pieces = run_board_profile_main.local_pieces(REPOSITORY)
		const ledger = pieces.find((piece) => piece.label === 'ledger')

		expect(ledger?.per_minute).toBe(MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS)
		expect(ledger?.role).toBeUndefined()
	})

	it('reads the ledger of the given repository', async () => {
		vi.mocked(run_event_tail.read_events).mockReturnValue([])
		const entries_of = vi.spyOn(run_board_ledger_window, 'entries_of').mockReturnValue([])

		const ledger = run_board_profile_main
			.local_pieces(REPOSITORY)
			.find((piece) => piece.label === 'ledger')

		await ledger?.run()

		expect(entries_of).toHaveBeenCalledWith(lane_ledger.target_of(REPOSITORY), expect.any(Number))
	})

	it('counts the sysctl and the local read as round parts, and the shares and ps outside them', () => {
		vi.mocked(run_event_tail.read_events).mockReturnValue([])

		const pieces = [
			...run_board_profile_main.machine_pieces(),
			...run_board_profile_main.local_pieces(REPOSITORY),
		]
		const parts = pieces.filter((piece) => piece.role === 'part').map((piece) => piece.label)

		expect(parts).toStrictEqual(['sysctl', 'local read (stream + git + lanes)'])
	})
})
