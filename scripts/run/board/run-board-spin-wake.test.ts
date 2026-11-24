import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_spin, type Turning } from './run-board-spin'
import { run_board_stall, type StallProbes } from './run-board-stall'
import { run_board_timing } from './run-board-timing'
import { run_board_type_rows } from './run-board-type-rows'

// joshuafolkken/kit#8902: `run:board --timing` takes each spinner wake's due and actual time, and says the
// wakes' lateness — its max, median and the wakes later than `LATE_MS` — as a live board leaves.

const { harness } = run_board_fixture
const { LATE_MS } = run_board_stall
const { REDRAW_MS } = run_board_spin
const { NO_TYPING } = run_board_type_rows
const OVERSLEEP_MS = 7
const LONG_LATE_MS = 60
const DUE_MS = 100
const SPIN_WAKE = new RegExp(
	String.raw`spin wake lag +max 60\.0 · median 30\.0 · n 1 over ${String(LATE_MS)} \(n 2\)`,
	'u',
)

type Wake = [number, number]

// Spinner ports on a clock each sleep moves `OVERSLEEP_MS` past its due time, every wake kept.
function waking(): {
	ports: Parameters<typeof run_board_spin.spin_to_second>[1]
	wakes: Array<Wake>
} {
	const clock = { now_ms: 0 }
	const wakes: Array<Wake> = []
	const ports = {
		now: () => clock.now_ms,
		write: vi.fn(),
		sleep: async (ms: number) => {
			clock.now_ms += ms + OVERSLEEP_MS
		},
		time_wake: (due_ms: number, woke_ms: number) => {
			wakes.push([due_ms, woke_ms])
		},
	}

	return { ports, wakes }
}

// Probes whose timer and GC observer never fire.
function quiet_probes(): StallProbes {
	return {
		now: () => 0,
		every: vi.fn<StallProbes['every']>().mockReturnValue(vi.fn()),
		observe_gc: vi.fn<StallProbes['observe_gc']>().mockReturnValue(vi.fn()),
	}
}

describe('run_board_spin.spin_to_second wakes', () => {
	it('hands a still frame its one wake on the second, due and actual', async () => {
		const { ports, wakes } = waking()
		const turning: Turning = { spots: [], typing: NO_TYPING }

		await run_board_spin.spin_to_second(turning, ports)

		expect(wakes).toStrictEqual([[REDRAW_MS, REDRAW_MS + OVERSLEEP_MS]])
	})

	it('hands every wake that turns the spinners, each past its due time by the oversleep', async () => {
		const { ports, wakes } = waking()
		const turning: Turning = { spots: [{ row: 1, column: 1, style: '' }], typing: NO_TYPING }

		await run_board_spin.spin_to_second(turning, ports)

		expect(wakes.length).toBeGreaterThan(1)
		expect(wakes.map(([due_ms, woke_ms]) => woke_ms - due_ms)).toStrictEqual(
			wakes.map(() => OVERSLEEP_MS),
		)
	})
})

describe('run_board_timing.timed wakes', () => {
	it('says the spinner wakes taken after the screen, by their lateness, as the board leaves', () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const board = run_board_timing.timed(ports, true, { now: () => 0, probes: quiet_probes() })

		board.time_wake?.(0, LONG_LATE_MS)
		board.on_exit(() => 0)
		board.time_wake?.(DUE_MS, DUE_MS + LONG_LATE_MS)
		board.time_wake?.(DUE_MS, DUE_MS - 1)
		leaves.at(-1)?.()

		expect(frames.at(-1)).toMatch(SPIN_WAKE)
	})

	it('says no spinner wake row where none woke', () => {
		const { ports, frames, leaves } = harness(undefined, [])
		const board = run_board_timing.timed(ports, true, { now: () => 0, probes: quiet_probes() })

		board.on_exit(() => 0)
		leaves.at(-1)?.()

		expect(frames.at(-1)).not.toContain(run_board_timing.SPIN_WAKE_ROW)
	})

	it('takes no wake without the flag, the spinners waking as before', async () => {
		const { ports } = harness(undefined, [])
		const board = run_board_timing.timed(ports, false)

		expect(board.time_wake).toBeUndefined()
		await expect(
			run_board_spin.spin_to_second({ spots: [], typing: NO_TYPING }, board),
		).resolves.toBeUndefined()
	})
})
