import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DropScreen, ScreenCell } from './run-board-drop-screen'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_paint } from './run-board-jump-paint'
import { run_board_jump_screen, type JumpDraw } from './run-board-jump-screen'

const { ARRIVE_THAW_TICKS, ARRIVE_TICKS, TICK_MS, WASH_TICKS, THAW_TICKS } = run_board_jump
const { FRAME_MS, arrive_beats, jump_bytes } = run_board_jump_screen
// Taken before any spy, so a spy can call the real one.
const { arrive_cells } = run_board_jump_paint

const ESC = '\u{1B}'
const CLEAR = `${ESC}[H${ESC}[J`
const SYNC = new RegExp(String.raw`${ESC}\[\?2026[hl]`, 'gu')
const PLACE = new RegExp(String.raw`${ESC}\[(\d+;\d+)H`, 'u')
// A cell written is its place and its bytes.
const PAIR = 2
const STYLE = `${ESC}[38;2;10;20;30m`
const ARRIVE_FRAME = `${STYLE}AB${ESC}[0m\n${STYLE}CD${ESC}[0m`
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

// Each cell a beat writes, by `row;column`, with the bytes written there.
function cells_written(text: string): Array<[string, string]> {
	const parts = text.replaceAll(SYNC, '').split(PLACE).slice(1)

	return Array.from({ length: parts.length / PAIR }, (_, index) => [
		parts[index * PAIR] ?? '',
		parts[index * PAIR + 1] ?? '',
	])
}

// A terminal the beats are written to in turn: each cell's last bytes, by `row;column`.
function applied(texts: ReadonlyArray<string>): Map<string, string> {
	return new Map(texts.flatMap((text) => cells_written(text)))
}

// The arrival `tick` ticks in written whole: the first beat of an arrival whose every tick is that one.
function whole(drawn: string, tick: number): string {
	vi.spyOn(run_board_jump_paint, 'arrive_cells').mockImplementation((cells) =>
		arrive_cells(cells, tick),
	)
	const first = arrive_beats(drawn, undefined).next().value?.text ?? ''

	vi.restoreAllMocks()

	return first
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
	it('leaves the animation area to its own painter', () => {
		const lamp = { row: 3, column: 3, panel_row: 0, panel_rows: 1, group: 0, lamp: 0 }
		const draw = {
			...draw_of(['ABC', 'DEF', 'GHI']),
			panel: { top: 3, end: 4, rows: 1, lamps: [lamp] },
		}
		const written = jump_bytes(draw, WASH_MS, undefined)

		expect(written).toContain(`${ESC}[1;1H`)
		expect(written).not.toContain(`${ESC}[3;3H`)
		expect(written).toContain(`${ESC}[3;1H`)
	})

	// joshuafolkken/kit#8739: the area's painter writes from its first lamp place, so the column before
	// it, left to neither painter, kept the wash as a line once the jump was over.
	it('ac-f0dce629 washes and puts back the column left of the area as its neighbors', () => {
		const lamp = { row: 3, column: 3, panel_row: 0, panel_rows: 1, group: 0, lamp: 0 }
		const draw = {
			...draw_of(['ABC', 'DEF', 'GHI']),
			panel: { top: 3, end: 4, rows: 1, lamps: [lamp] },
		}

		expect(jump_bytes(draw, WASH_MS, undefined)).toContain(`${ESC}[3;2H`)
		expect(jump_bytes(draw, OVER_MS, WASH_MS)).toContain(`${ESC}[3;2H${ESC}[0m${STYLE}H`)
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

describe('run_board_jump_screen.arrive_beats — only the changed cells, a beat when taken', () => {
	const texts = [...arrive_beats(ARRIVE_FRAME, undefined)].map((beat) => beat.text)
	const CELLS = 4

	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('ac-6688480d writes past the first beat only the cells that changed since the beat before', () => {
		const is_fresh = texts.slice(1).map((text, index) => {
			const shown = applied(texts.slice(0, index + 1))

			return cells_written(text).every(([key, bytes]) => shown.get(key) !== bytes)
		})

		expect(cells_written(texts[0] ?? '')).toHaveLength(CELLS)
		expect(is_fresh.every(Boolean)).toBe(true)
		expect(texts.slice(1).some((text) => cells_written(text).length < CELLS)).toBe(true)
	})

	it('ac-454bc468 leaves the screen, every beat applied in turn, as each beat written whole', () => {
		const ticks = [ARRIVE_THAW_TICKS, ARRIVE_TICKS - 1]

		expect(ticks.map((tick) => applied(texts.slice(0, tick + 1)))).toStrictEqual(
			ticks.map((tick) => applied([whole(ARRIVE_FRAME, tick)])),
		)
	})

	it('ac-b9f6760e builds a beat only when it is taken', () => {
		const built = vi.spyOn(run_board_jump_paint, 'arrive_cells')
		const lazy = arrive_beats(ARRIVE_FRAME, undefined)

		expect(built).not.toHaveBeenCalled()
		lazy.next()
		expect(built).toHaveBeenCalledOnce()
	})
})

describe('run_board_jump_screen.arrive_beats', () => {
	const beats = [...arrive_beats(ARRIVE_FRAME, undefined)]
	const texts = beats.map((beat) => beat.text)

	it('beats every tick over the arrival', () => {
		expect(beats).toHaveLength(ARRIVE_TICKS)
		expect(beats.every((beat) => beat.ms === TICK_MS)).toBe(true)
	})

	it('clears the screen on the first beat only', () => {
		expect(beats[0]?.text).toContain(CLEAR)
		expect(beats.slice(1).some((beat) => beat.text.includes(CLEAR))).toBe(false)
	})

	it('leaves no letter black while it thaws', () => {
		const thaw = beats.slice(-ARRIVE_THAW_TICKS)

		expect(thaw.some((beat) => has_black_letter(beat.text))).toBe(false)
	})

	it('ac-27df273f leaves each cell after the last beat as the frame after it draws it', () => {
		const shown = [...applied(texts).values()]

		expect(
			['A', 'B', 'C', 'D'].every((letter) =>
				shown.some((bytes) => bytes.includes(`${STYLE}${letter}`)),
			),
		).toBe(true)
	})

	it('keeps the wipe a held first frame starts with out of its cells', () => {
		const held = [...arrive_beats(`${CLEAR}${ARRIVE_FRAME}`, undefined)]

		expect(held.map((beat) => clears_in(beat.text))).toStrictEqual(
			beats.map((_, index) => (index === 0 ? 1 : 0)),
		)
	})
})

describe('run_board_jump_screen.arrive_beats — a named color', () => {
	const NAMED = `${ESC}[33m`
	const named = [...arrive_beats(`${NAMED}AB${ESC}[39m\n${ESC}[90mCD${ESC}[39m`, undefined)]
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
		const after = [...arrive_beats(`${NAMED}AB${ESC}[39mCD`, undefined)]
		const painted = after.flatMap((beat) => [...beat.text.matchAll(/38;2;(\d+);\d+;(\d+)mC/gu)])
		const [, red = '255', blue = '0'] = painted.at(-1) ?? []

		expect(Number(red) - Number(blue)).toBeLessThan(YELLOW_LEAD)
	})

	it('ac-27df273f leaves it after the last beat as the frame after it draws it', () => {
		const shown = applied(named.map((beat) => beat.text))

		expect(shown.get('1;1')).toContain(`${NAMED}A${ESC}[0m`)
		expect(shown.get('2;2')).toContain(`${ESC}[90mD${ESC}[0m`)
	})
})
