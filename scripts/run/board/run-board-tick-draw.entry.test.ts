import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DropScreen } from './run-board-drop-screen'
import { run_board_fixture } from './run-board-fixture'
import type { BoardState } from './run-board-state'
import type { Theme } from './run-board-theme-defs'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8356: the matrix board draws its lamp panel as the idle rain, and its new rows decode
// on a terminal drawing color; elsewhere they type or show at once.

const { entry_of, has_drop, has_lamps, has_rain } = run_board_tick_draw
const MATRIX = { types_rows: true, theme: 'matrix', is_tty: true } as const
const WARGAMES = { ...MATRIX, theme: 'wargames' } as const
const ONCE = '--once, --chat and a pipe'
const EVERY = '--every'
// The rule glyph the board draws, and the dash the matrix theme draws it as.
const RULE = '─'
const DASH = '-'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tick_draw.has_rain', () => {
	it('draws the matrix board’s lamp panel, as the idle rain, on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(MATRIX)).toBe(true)
		expect(has_rain(MATRIX)).toBe(true)
	})

	it('runs no rain in the wargames board’s panel', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(WARGAMES)).toBe(false)
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('runs none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_rain(ports)).toBe(false)
	})

	it('runs none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_rain(MATRIX)).toBe(false)
	})
})

// joshuafolkken/kit#8367: a drop falls down the matrix board every second, on the lamps' gate.
describe('run_board_tick_draw.has_drop', () => {
	it('drops one down the live matrix board on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_drop(MATRIX)).toBe(true)
	})

	it.each([
		['the wargames board', WARGAMES],
		['a board in no theme', { ...MATRIX, theme: undefined }],
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('drops none on %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_drop(ports)).toBe(false)
	})

	it('drops none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_drop(MATRIX)).toBe(false)
	})
})

describe('run_board_tick_draw.entry_of', () => {
	it('decodes the matrix board’s new rows on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(MATRIX)).toBe('decode')
	})

	it('types the wargames board’s new rows', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(WARGAMES)).toBe('type')
	})

	it.each([
		[ONCE, { ...MATRIX, is_tty: false }],
		[EVERY, { ...MATRIX, types_rows: false }],
	])('shows the matrix board’s rows at once with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(entry_of(ports)).toBe('none')
	})

	it('shows the matrix board’s rows at once on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(entry_of(MATRIX)).toBe('none')
	})
})

const WIDE = { rows: 60, columns: 200 }

function size(): { rows: number; columns: number } {
	return WIDE
}

// A live redraw of a frame in `theme`, on a terminal drawing color: the state its turns carry.
function redrawn_state(theme: Theme): BoardState {
	vi.stubEnv('FORCE_COLOR', '3')
	const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
	const { FRESH_STATE, layout_for } = run_board_tick
	const { ports } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const redraw = { ports: { ...ports, types_rows: true, theme, size }, now_ms: START }

	return drawn_from(state, LOCAL, redraw, layout_for(state, LOCAL, START))
}

// Whether the rain runs and rows decode on the redraw's turns.
function redrawn(theme: Theme): { is_rain: boolean; is_decoding: boolean } {
	const drawn = redrawn_state(theme)

	return { is_rain: drawn.is_rain === true, is_decoding: drawn.typing?.is_decoding === true }
}

function screen_texts(drop: DropScreen | undefined): Array<string> {
	return (drop?.rows ?? []).map((row) => row.map((cell) => cell.text).join(''))
}

describe('run_board_tick_draw.draw_display with the entry', () => {
	it('keeps the rain and the decoding for the matrix board’s turns', () => {
		expect(redrawn('matrix')).toStrictEqual({ is_rain: true, is_decoding: true })
	})

	it('keeps neither for the wargames board’s turns', () => {
		expect(redrawn('wargames')).toStrictEqual({ is_rain: false, is_decoding: false })
	})
})

// joshuafolkken/kit#8367: the drop falls down the frame's cells as the theme drew them, so a rule cell
// it leaves is put back in the rule's own paint, not the theme's phosphor.
describe('run_board_tick_draw.draw_display with the drop', () => {
	it('keeps the matrix frame’s cells as the theme draws them, at the pane’s size', () => {
		const { drop } = redrawn_state('matrix')
		const texts = screen_texts(drop)

		expect(drop?.columns).toBe(WIDE.columns)
		expect(texts.length).toBeGreaterThan(0)
		expect(texts.length).toBeLessThanOrEqual(WIDE.rows)
		expect(texts.some((text) => text.includes(RULE))).toBe(false)
		expect(texts.some((text) => text.includes(DASH))).toBe(true)
	})

	it('keeps no drop for the wargames board’s turns', () => {
		expect(redrawn_state('wargames').drop).toBeUndefined()
	})
})
