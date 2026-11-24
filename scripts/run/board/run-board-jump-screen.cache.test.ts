import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_drop_screen, type DropScreen } from './run-board-drop-screen'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'
import type { GlyphBytes } from './run-board-layer'

const { TICK_MS, WASH_TICKS } = run_board_jump
const { FRAME_MS, wash_at } = run_board_jump_screen

const STYLE = '\u{1B}[38;2;10;20;30m'
const LINES = ['AB', 'CD']
const CELLS = 4
const RUN = { start_ms: 0, letters: CELLS }
const WASH_MS = CELLS * TICK_MS
const FRAMES = WASH_TICKS

function screen_of(lines: ReadonlyArray<string>): DropScreen {
	return {
		rows: lines.map((line) => Array.from(line, (text) => ({ text, style: STYLE, is_wide: false }))),
		columns: Math.max(...lines.map((line) => line.length)),
		skips: new Set(),
		typing_rows: new Set(),
	}
}

function draw_of(lines: ReadonlyArray<string>): JumpDraw {
	return { run: RUN, screen: screen_of(lines), scene: { rows: lines.length, panel: undefined } }
}

// The frames of a jump drawn in turn, a frame each `FRAME_MS` from the wash on.
function frames_of(draw: () => JumpDraw): Array<Array<[string, GlyphBytes]>> {
	return Array.from({ length: FRAMES }, (_, index) => [
		...wash_at(draw(), WASH_MS + index * FRAME_MS),
	])
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_jump_screen.wash_at — a draw read once', () => {
	it("reads a draw's cells once over every frame of it", () => {
		const held = vi.spyOn(run_board_drop_screen, 'is_held')

		frames_of(() => draw_of(LINES))
		const fresh_reads = held.mock.calls.length

		held.mockClear()
		const draw = draw_of(LINES)

		frames_of(() => draw)

		expect(held.mock.calls).toHaveLength(CELLS)
		expect(fresh_reads).toBeGreaterThan(CELLS)
	})

	it('paints each frame as a draw read afresh paints it', () => {
		const draw = draw_of(LINES)

		expect(frames_of(() => draw)).toStrictEqual(frames_of(() => draw_of(LINES)))
	})
})
