import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
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

// A live redraw of a frame in `theme`, on a terminal drawing color: whether the rain runs and rows decode.
function redrawn(theme: Theme): { is_rain: boolean; is_decoding: boolean } {
	vi.stubEnv('FORCE_COLOR', '3')
	const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
	const { FRESH_STATE, layout_for } = run_board_tick
	const { ports } = harness(LOCAL, [])
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const redraw = { ports: { ...ports, types_rows: true, theme, size }, now_ms: START }
	const drawn = drawn_from(state, LOCAL, redraw, layout_for(state, LOCAL, START))

	return { is_rain: drawn.is_rain === true, is_decoding: drawn.typing?.is_decoding === true }
}

describe('run_board_tick_draw.draw_display with the entry', () => {
	it('keeps the rain and the decoding for the matrix board’s turns', () => {
		expect(redrawn('matrix')).toStrictEqual({ is_rain: true, is_decoding: true })
	})

	it('keeps neither for the wargames board’s turns', () => {
		expect(redrawn('wargames')).toStrictEqual({ is_rain: false, is_decoding: false })
	})
})
