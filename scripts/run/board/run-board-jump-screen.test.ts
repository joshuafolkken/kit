import { describe, expect, it } from 'vitest'
import type { DropScreen, ScreenCell } from './run-board-drop-screen'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'

const { ARRIVE_TICKS, TICK_MS, WASH_TICKS, THAW_TICKS } = run_board_jump
const { FRAME_MS, arrive_beats, jump_bytes } = run_board_jump_screen

const ESC = '\u{1B}'
const CLEAR = `${ESC}[H${ESC}[J`
const STYLE = `${ESC}[38;2;10;20;30m`
const LETTERS = 4
const RUN = { start_ms: 0, letters: LETTERS }
// The first moment of the wash, and a moment past the end of the thaw.
const WASH_MS = LETTERS * TICK_MS
const OVER_MS = (LETTERS + WASH_TICKS + THAW_TICKS) * TICK_MS
const HALF_FRAME = FRAME_MS / 2

function cell(text: string): ScreenCell {
	return { text, style: STYLE, is_wide: false }
}

function screen_of(lines: ReadonlyArray<string>): DropScreen {
	return {
		rows: lines.map((line) => Array.from(line, (letter) => cell(letter))),
		columns: Math.max(...lines.map((line) => line.length)),
		skips: new Set(),
		typing_rows: new Set(),
	}
}

function draw_of(lines: ReadonlyArray<string>): JumpDraw {
	return {
		run: RUN,
		screen: screen_of(lines),
		scene: { rows: lines.length, lane: undefined, panel: undefined },
	}
}

describe('run_board_jump_screen.jump_bytes', () => {
	it('writes nothing with no jump', () => {
		expect(jump_bytes(undefined, WASH_MS, undefined)).toBe('')
	})

	it('writes nothing again within the frame it last wrote', () => {
		const draw = draw_of(['AB', 'CD'])

		expect(jump_bytes(draw, WASH_MS + HALF_FRAME - 1, WASH_MS)).toBe('')
	})

	it('paints every cell the wash changes, at its place', () => {
		const written = jump_bytes(draw_of(['AB', 'CD']), WASH_MS, undefined)

		expect(written).toContain(`${ESC}[1;1H`)
		expect(written).toContain(`${ESC}[2;2H`)
		expect(written).toContain('D')
	})

	it('puts each painted cell back as the theme drew it once the jump is over', () => {
		const written = jump_bytes(draw_of(['AB']), OVER_MS, WASH_MS)

		expect(written).toContain(`${ESC}[1;1H${ESC}[0m${STYLE}A${ESC}[0m`)
		expect(written).toContain(`${ESC}[1;2H${ESC}[0m${STYLE}B${ESC}[0m`)
	})

	it('writes nothing once the jump is over and already put back', () => {
		expect(jump_bytes(draw_of(['AB']), OVER_MS + FRAME_MS, OVER_MS)).toBe('')
	})
})

describe('run_board_jump_screen.arrive_beats', () => {
	const beats = arrive_beats(`${STYLE}AB${ESC}[0m\n${STYLE}CD${ESC}[0m`, undefined)

	it('beats every frame over the arrival', () => {
		const step = FRAME_MS / TICK_MS

		expect(beats).toHaveLength(Math.ceil(ARRIVE_TICKS / step))
		expect(beats.every((beat) => beat.ms === FRAME_MS)).toBe(true)
	})

	it('clears the screen on the first beat only', () => {
		expect(beats[0]?.text).toContain(CLEAR)
		expect(beats.slice(1).some((beat) => beat.text.includes(CLEAR))).toBe(false)
	})

	it('writes every cell on the first beat and only the changed ones after', () => {
		const first = beats[0]?.text ?? ''

		expect(first).toContain(`${ESC}[2;2H`)
		expect(beats.some((beat, index) => index > 0 && beat.text === '')).toBe(true)
		expect(beats.some((beat, index) => index > 0 && beat.text.includes('D'))).toBe(true)
	})
})
