import { describe, expect, it } from 'vitest'
import type { Pane } from './run-board-theme-draw'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type { Cell, ThemeApi } from './run-board-theme-host-types'
import { run_board_theme_rk800_data } from './run-board-theme-rk800-data'
import { run_board_theme_rk800_parts } from './run-board-theme-rk800-parts'

// joshuafolkken/kit#9096: the rk800 theme's small parts — the bar's width, the waiting ring, the
// date card read off the board's clock, and what the plate, the ornament and the triangle draw.

const { HOST } = run_board_theme_host_fixture
const { state_of } = run_board_theme_host_state
const { BAR, PANEL, RING, TRIANGLE } = run_board_theme_rk800_data
const { bar_width, card_of, lay_date, ornament, plate, ring_glyph, stage_of, triangle } =
	run_board_theme_rk800_parts
const PANE_W = 24
const PANE_H = 7

function blank_pane(): Pane {
	const grid = Array.from({ length: PANE_H }, () =>
		Array.from({ length: PANE_W }, (): Cell => [' ', 'body']),
	)

	return { grid, box: { x: 0, y: 0, w: PANE_W, h: PANE_H } }
}

function text_of(pane: Pane, y: number): string {
	return (pane.grid[y] ?? []).map(([ch]) => ch).join('')
}

function api_with(clock: string): ThemeApi {
	return { ...HOST.api, layout: { ...HOST.layout, dated_clocks: ['', clock] } }
}

describe('run_board_theme_rk800_parts.bar_width', () => {
	it('keeps the bar between its least and its most', () => {
		expect([
			bar_width(0),
			bar_width(BAR.margin + BAR.min + 1),
			bar_width(PANE_W * PANE_W),
		]).toStrictEqual([BAR.min, BAR.min + 1, BAR.max])
	})
})

describe('run_board_theme_rk800_parts.ring_glyph', () => {
	it('holds a glyph for its pace, then turns to the next', () => {
		const glyphs = [...RING.glyphs]

		expect([ring_glyph(0), ring_glyph(RING.pace - 1), ring_glyph(RING.pace)]).toStrictEqual([
			glyphs[0],
			glyphs[0],
			glyphs[1],
		])
	})

	it('comes round to its first glyph after a whole turn', () => {
		expect(ring_glyph(RING.pace * RING.glyphs.length)).toBe(ring_glyph(0))
	})
})

describe('run_board_theme_rk800_parts.card_of', () => {
	it('reads the header clock as a date, a half-day and a time', () => {
		expect(card_of(HOST.api)).toStrictEqual({ date: 'NOV 24TH', half: 'PM', time: '07:10' })
	})

	it('prefers the dated clock and reads midnight as twelve', () => {
		expect(card_of(api_with('03-01 00:05'))).toStrictEqual({
			date: 'MAR 1ST',
			half: 'AM',
			time: '12:05',
		})
	})

	it('gives no date where the clock tells only a time', () => {
		expect(card_of(api_with('12:30'))).toStrictEqual({ date: '', half: 'PM', time: '12:30' })
	})

	it('gives no card where the board shows no clock', () => {
		expect(card_of(api_with('no clock here'))).toBeUndefined()
	})
})

describe('run_board_theme_rk800_parts.lay_date', () => {
	const card = { date: 'NOV 24TH', half: 'PM', time: '07:10' }

	it('lays the whole card with its gaps', () => {
		const pane = blank_pane()

		lay_date(pane, { x: 0, y: 0 }, card, PANE_W)
		expect(text_of(pane, 0).trimEnd()).toBe('NOV 24TH  PM 07:10')
	})

	it('lays only the letters typed so far', () => {
		const pane = blank_pane()

		lay_date(pane, { x: 0, y: 0 }, card, card.date.length)
		expect(text_of(pane, 0).trimEnd()).toBe('NOV 24TH')
	})
})

describe('run_board_theme_rk800_parts.plate', () => {
	it('frames its label in corner brackets', () => {
		const pane = blank_pane()

		plate(pane, { x: 1, y: 0 }, 'ANALYZE', '1;2;3')
		expect(text_of(pane, 0).trimEnd()).toBe(' ⌜ ANALYZE ⌟')
	})
})

describe('run_board_theme_rk800_parts.ornament', () => {
	it('draws a dot at each end and a cross along a long line', () => {
		const pane = blank_pane()

		ornament({ pane, right: PANE_W - 1, bottom: PANE_H - 1, body: PANEL.body }, 0)
		const line = text_of(pane, 0).trim()

		expect([line.at(0), line.at(-1), line.includes('+')]).toStrictEqual(['·', '·', true])
	})
})

describe('run_board_theme_rk800_parts.stage_of', () => {
	it('lays the stage out on the panel', () => {
		const draw = {
			api: HOST.api,
			grid: HOST.board,
			s: state_of(HOST.layout, HOST.events.i, 0),
			tick: 0,
		}
		const stage = stage_of(draw)

		expect(stage.right).toBe(HOST.layout.pw - 1)
		expect(stage.body).toBe(stage.pane.box.h < PANEL.rows ? PANEL.body - 1 : PANEL.body)
	})
})

describe('run_board_theme_rk800_parts.triangle', () => {
	it('draws its rows and leaves its blank cells alone', () => {
		const pane = blank_pane()

		triangle(pane, { x: 0, y: 0 }, 0, '10;20;30')
		expect(TRIANGLE.map((line, y) => text_of(pane, y).slice(0, line.length))).toStrictEqual(
			TRIANGLE,
		)
		expect(pane.grid[0]?.[0]).toStrictEqual([' ', 'body'])
	})
})
