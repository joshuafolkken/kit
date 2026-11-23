import { describe, expect, it } from 'vitest'
import type { DropScreen, ScreenCell } from './run-board-drop-screen'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'

const { ARRIVE_TICKS, TICK_MS, WASH_TICKS, THAW_TICKS } = run_board_jump
const { FRAME_MS, arrive_beats, is_lit, jump_bytes } = run_board_jump_screen

const ESC = '\u{1B}'
const CLEAR = `${ESC}[H${ESC}[J`
const STYLE = `${ESC}[38;2;10;20;30m`
const LETTERS = 4
const RUN = { start_ms: 0, letters: LETTERS }
// The first moment of the wash, and a moment past the end of the thaw.
const WASH_MS = LETTERS * TICK_MS
const OVER_MS = (LETTERS + WASH_TICKS + THAW_TICKS) * TICK_MS
const HALF_FRAME = FRAME_MS / 2
const LONG_AFTER_MS = 1000 * TICK_MS

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
		scene: { rows: lines.length, panel: undefined },
	}
}

function clears_in(text: string): number {
	return text.split(CLEAR).length - 1
}

// Whether a cell is painted black with a letter on it — a letter lost to the dark.
function has_black_letter(text: string): boolean {
	return text
		.split('38;2;0;0;0m')
		.slice(1)
		.some((rest) => rest[0] !== ' ' && rest[0] !== ESC)
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

describe('run_board_jump_screen.jump_bytes around the other painters', () => {
	it("leaves the cells the area's painter draws to it", () => {
		const draw = { ...draw_of(['ABC', 'DEF', 'GHI']), owned: new Set(['3;3']) }
		const written = jump_bytes(draw, WASH_MS, undefined)

		expect(written).toContain(`${ESC}[1;1H`)
		expect(written).not.toContain(`${ESC}[3;3H`)
		expect(written).toContain(`${ESC}[3;1H`)
	})

	// joshuafolkken/kit#8739: the column left of the painter's cells, left to neither painter, kept the
	// wash as a line once the jump was over.
	it('ac-f0dce629 washes and puts back the column left of the area as its neighbors', () => {
		const draw = { ...draw_of(['ABC', 'DEF', 'GHI']), owned: new Set(['3;3']) }

		expect(jump_bytes(draw, WASH_MS, undefined)).toContain(`${ESC}[3;2H`)
		expect(jump_bytes(draw, OVER_MS, WASH_MS)).toContain(`${ESC}[3;2H${ESC}[0m${STYLE}H`)
	})

	// joshuafolkken/kit#8782: the area's lamp rows and the gauge's right, which its painter does not
	// draw, stayed black through the flash.
	it('ac-712f67d1 washes the cells of the area its painter does not draw', () => {
		const draw = { ...draw_of(['AB C', 'DE F']), owned: new Set(['2;2', '2;3']) }
		const written = jump_bytes(draw, WASH_MS, undefined)

		expect(written).toContain(`${ESC}[2;4H`)
		expect(written).toContain(`${ESC}[2;1H`)
		expect(written).not.toContain(`${ESC}[2;2H`)
	})

	// joshuafolkken/kit#8782: the lanes' spinners, kept out of the light, drew a black line down their
	// left edge through the flash.
	it('ac-9a24befb washes the spinners as their neighbors', () => {
		const base = draw_of(['ABC', 'DEF'])
		const draw = { ...base, screen: { ...base.screen, skips: new Set(['1;1', '2;1']) } }
		const written = jump_bytes(draw, WASH_MS, undefined)

		expect(written).toContain(`${ESC}[1;1H`)
		expect(written).toContain(`${ESC}[2;1H`)
	})

	it('still leaves the rows typing alone', () => {
		const base = draw_of(['ABC', 'DEF'])
		const draw = { ...base, screen: { ...base.screen, typing_rows: new Set([2]) } }

		expect(jump_bytes(draw, WASH_MS, undefined)).not.toContain(`${ESC}[2;1H`)
	})
})

describe('run_board_jump_screen.is_lit', () => {
	it('holds while the jump runs, not before a jump or once it is over', () => {
		expect(is_lit(draw_of(['AB']), WASH_MS)).toBe(true)
		expect(is_lit(draw_of(['AB']), LONG_AFTER_MS)).toBe(false)
		expect(is_lit(undefined, WASH_MS)).toBe(false)
	})
})

describe('run_board_jump_screen.jump_bytes — the frame rate', () => {
	it('ac-ac82abe9 draws a frame every 50 ms, a tick each', () => {
		const draw = draw_of(['AB', 'CD'])

		expect(FRAME_MS).toBe(50)
		expect(FRAME_MS).toBe(TICK_MS)
		// The wash turns to its second tint two ticks in, a frame after the one before.
		const second_ms = WASH_MS + 2 * FRAME_MS

		expect(jump_bytes(draw, second_ms, second_ms - FRAME_MS)).not.toBe('')
	})
})

describe('run_board_jump_screen.arrive_beats', () => {
	const ARRIVE_FRAME = `${STYLE}AB${ESC}[0m\n${STYLE}CD${ESC}[0m`
	const beats = arrive_beats(ARRIVE_FRAME, undefined)
	const PLACES = ['1;1', '1;2', '2;1', '2;2'].map((place) => `${ESC}[${place}H`)

	it('beats every tick over the arrival', () => {
		expect(beats).toHaveLength(ARRIVE_TICKS)
		expect(beats.every((beat) => beat.ms === TICK_MS)).toBe(true)
	})

	it('clears the screen on the first beat only', () => {
		expect(beats[0]?.text).toContain(CLEAR)
		expect(beats.slice(1).some((beat) => beat.text.includes(CLEAR))).toBe(false)
	})

	it('writes every cell of the screen on every beat', () => {
		expect(beats.every((beat) => PLACES.every((place) => beat.text.includes(place)))).toBe(true)
	})

	it('leaves no letter black while it thaws', () => {
		const thaw = beats.slice(-THAW_TICKS)

		expect(thaw.some((beat) => has_black_letter(beat.text))).toBe(false)
	})

	it('ac-27df273f writes each cell on the last beat as the frame after it draws it', () => {
		const last = beats.at(-1)?.text ?? ''

		expect(['A', 'B', 'C', 'D'].every((letter) => last.includes(`${STYLE}${letter}`))).toBe(true)
	})

	it('keeps the wipe a held first frame starts with out of its cells', () => {
		const held = arrive_beats(`${CLEAR}${ARRIVE_FRAME}`, undefined)

		expect(held.map((beat) => clears_in(beat.text))).toStrictEqual(
			beats.map((_, index) => (index === 0 ? 1 : 0)),
		)
	})
})

describe('run_board_jump_screen.arrive_beats — a named color', () => {
	const NAMED = `${ESC}[33m`
	const named = arrive_beats(`${NAMED}AB${ESC}[39m\n${ESC}[90mCD${ESC}[39m`, undefined)
	const GRAY = '38;2;204;204;204m'
	// Yellow (229;229;16) is far more red than blue; the gray and the ice it thaws from are not.
	const YELLOW_LEAD = 100

	it('ac-5324c95f thaws a named color toward itself, not gray', () => {
		const painted = named.flatMap((beat) => [...beat.text.matchAll(/38;2;(\d+);\d+;(\d+)mA/gu)])
		const [, red = '0', blue = '255'] = painted.at(-1) ?? []

		expect(named.some((beat) => beat.text.includes(GRAY))).toBe(false)
		expect(Number(red) - Number(blue)).toBeGreaterThan(YELLOW_LEAD)
	})

	it('thaws plain text after a named color back to the default, not that color', () => {
		const after = arrive_beats(`${NAMED}AB${ESC}[39mCD`, undefined)
		const painted = after.flatMap((beat) => [...beat.text.matchAll(/38;2;(\d+);\d+;(\d+)mC/gu)])
		const [, red = '255', blue = '0'] = painted.at(-1) ?? []

		expect(Number(red) - Number(blue)).toBeLessThan(YELLOW_LEAD)
	})

	it('ac-27df273f writes it on the last beat as the frame after it draws it', () => {
		const last = named.at(-1)?.text ?? ''

		expect(last).toContain(`${NAMED}A${ESC}[0m`)
		expect(last).toContain(`${ESC}[90mD${ESC}[0m`)
	})
})
