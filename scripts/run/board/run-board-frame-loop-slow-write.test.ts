import { describe, expect, it } from 'vitest'
import { run_board_cells } from './run-board-cells'
import { run_board_frame_loop, type FramePorts } from './run-board-frame-loop'
import { run_board_layer, type Layer } from './run-board-layer'

// joshuafolkken/kit#8950: a frame whose write takes a while still wakes for the change due during it.

const { MIN_FRAME_MS, run, screen_of } = run_board_frame_loop
const { boundary_after } = run_board_layer
const START = 1_000_000
const SECOND_MS = 1000
const BLINK_MS = 500
const SPIN_MS = 80
const WRITE_MS = 25
const SIZE = { rows: 2, columns: 8 }
const DIGITS = 10
const { char_id } = run_board_cells

// A layer that shows its step count at `column`, changing on every `step_ms`.
function every(step_ms: number, column: number): Layer {
	return {
		is_decor: false,
		next_change_ms: (now_ms) => boundary_after(now_ms, step_ms),
		draw: (canvas, at_ms) => {
			const digit = Math.floor(at_ms / step_ms) % DIGITS

			run_board_cells.put(canvas, column, char_id(String(digit)), 0)
		},
	}
}

// The moments frames are made at, each write taking `write_ms`.
async function frame_times(
	write_ms: number,
	wakes: Array<{ due_ms: number; woke_ms: number }> = [],
): Promise<Array<number>> {
	const clock = { now_ms: START }
	const times: Array<number> = []
	const ports: FramePorts = {
		time_wake: (due_ms, woke_ms) => {
			wakes.push({ due_ms, woke_ms })
		},
		now: () => clock.now_ms,
		sleep: async (ms) => {
			clock.now_ms += Math.max(0, ms)
		},
		write: () => {
			times.push(clock.now_ms)
			clock.now_ms += write_ms
		},
		size: () => SIZE,
	}
	const layers = [every(SPIN_MS, 0), every(BLINK_MS, 1)]
	const frame_run = { layers, until_ms: START + SECOND_MS, is_still: false }

	await run(frame_run, ports, screen_of())

	return times
}

describe('run_board_frame_loop.run on a terminal slow to take a write', () => {
	it('makes a frame within a refresh of every change, even one a write ran past', async () => {
		const times = await frame_times(WRITE_MS)
		const spins = Array.from({ length: SECOND_MS / SPIN_MS }, (_, step) => step * SPIN_MS)
		const dues = [...spins, BLINK_MS].filter((offset_ms) => offset_ms > 0)
		const missed = dues.filter((offset_ms) =>
			times.every(
				(at_ms) => !(at_ms - START >= offset_ms && at_ms - START <= offset_ms + MIN_FRAME_MS),
			),
		)

		expect(missed).toStrictEqual([])
	})

	it('hands the wake timing no due moment before the wake began', async () => {
		const wakes: Array<{ due_ms: number; woke_ms: number }> = []

		await frame_times(WRITE_MS, wakes)

		expect(wakes.filter((wake) => wake.due_ms > wake.woke_ms)).toStrictEqual([])
		expect(wakes.every((wake) => wake.woke_ms - wake.due_ms <= MIN_FRAME_MS)).toBe(true)
	})
})
