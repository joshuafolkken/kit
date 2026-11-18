import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_board_gather } from '#scripts/run/board/run-board-gather'
import { run_event_tail } from '#scripts/run/event/run-event-tail'
import { describe, expect, it, vi } from 'vitest'
import { run_board_profile } from './run-board-profile'
import { run_board_profile_main } from './run-board-profile-main'

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

		const pieces = run_board_profile_main.local_pieces('/repository')
		const shares = pieces.filter((piece) =>
			['lane records read', 'throughput fold'].includes(piece.label),
		)

		expect(shares.map((piece) => piece.per_minute)).toStrictEqual([
			MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS,
			MS_PER_MINUTE / run_board_gather.LOCAL_READ_MS,
		])
	})
})
