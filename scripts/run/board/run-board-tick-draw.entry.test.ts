import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardState } from './run-board-state'
import type { Theme } from './run-board-theme-defs'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'

// joshuafolkken/kit#8917: the lamp panel a themed live board's theme lays itself out by, on a terminal
// drawing color; and the rows a themed board types, recorded for its theme layer and written whole.

const { has_lamps } = run_board_tick_draw
const THEMED = { types_rows: true, theme: 'trace', is_tty: true } as const
const ONCE = '--once, --chat and a pipe'
const WIDE = { rows: 60, columns: 200 }

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_tick_draw.has_lamps', () => {
	it.each(['wopr', 'trace', 'magi'] as const)(
		'draws the lamp panel on a live %s board drawing color',
		(theme) => {
			vi.stubEnv('FORCE_COLOR', '3')

			expect(has_lamps({ ...THEMED, theme })).toBe(true)
		},
	)

	// joshuafolkken/kit#8674: a live board whose rows do not type still draws it.
	it('draws it on a live board whose rows do not type', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps({ ...THEMED, types_rows: false, is_live: true })).toBe(true)
	})

	it.each([
		['no theme', { ...THEMED, theme: undefined }],
		['a board neither live nor typing', { ...THEMED, types_rows: false }],
		[ONCE, { ...THEMED, is_tty: false }],
	])('draws none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(has_lamps(ports)).toBe(false)
	})

	it('draws none on a terminal drawing no color', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(has_lamps(THEMED)).toBe(false)
	})
})

// A live redraw of a frame in `theme`, on a terminal drawing color, every write kept.
function redrawn(theme: Theme | undefined): { state: BoardState; written: Array<string> } {
	vi.stubEnv('FORCE_COLOR', '3')
	const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
	const { FRESH_STATE, layout_for } = run_board_tick
	const { ports } = harness(LOCAL, [])
	const written: Array<string> = []
	const state = { ...FRESH_STATE, plan: plan_titled('a'), run_started_ms: LOCAL.started_ms }
	const live = {
		...ports,
		types_rows: theme !== undefined,
		theme,
		size: () => WIDE,
		opened_ms: START,
		write: (text: string) => {
			written.push(text)
		},
	}

	return {
		state: drawn_from(
			state,
			LOCAL,
			{ ports: live, now_ms: START },
			layout_for(state, LOCAL, START),
		),
		written,
	}
}

describe('run_board_tick_draw.draw_display on a themed board', () => {
	it('keeps the frame’s keyed rows and the alert level for the theme layer', () => {
		const { state } = redrawn('wopr')

		expect(state.keyed?.length ?? 0).toBeGreaterThan(0)
		expect(state.alert_level).toBeDefined()
	})

	it('writes every row whole, no typing block in the frame', () => {
		const { written } = redrawn('wopr')

		expect(written).toHaveLength(1)
		expect(written.join('')).not.toContain('█')
	})

	it('types no row in no theme', () => {
		expect(redrawn(undefined).state.typing.seen).toBeUndefined()
	})
})
