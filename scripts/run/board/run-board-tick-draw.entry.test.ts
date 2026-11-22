import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DropScreen } from './run-board-drop-screen'
import { run_board_fixture } from './run-board-fixture'
import { run_board_flux_panel } from './run-board-flux-panel'
import { run_board_panel_painters } from './run-board-panel-painters'
import { run_board_rain_drop } from './run-board-rain-drop'
import type { BoardState } from './run-board-state'
import type { Theme } from './run-board-theme-defs'
import { run_board_tick } from './run-board-tick'
import { run_board_tick_draw } from './run-board-tick-draw'
import type { TypingSpan } from './run-board-type-rows'

// joshuafolkken/kit#8356: the matrix board draws its lamp panel as the idle rain, and its new rows decode
// on a terminal drawing color; elsewhere they type or show at once.

const { entry_of, has_drop, has_lamps, has_rain, panel_of } = run_board_tick_draw
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

// joshuafolkken/kit#8676: the theme's painter the turns carry, with the frame's animation area.
describe('run_board_tick_draw.panel_of', () => {
	const area = { top: 1, end: 80, rows: 7, lamps: [] }
	const { LAMP_PAINTER, RAIN_PAINTER } = run_board_panel_painters

	it('hands the matrix rain and the wargames lamps on a terminal drawing color', () => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(panel_of(MATRIX, { area })).toStrictEqual({ painter: RAIN_PAINTER, area })
		expect(panel_of(WARGAMES, { area })).toStrictEqual({ painter: LAMP_PAINTER, area })
	})

	// joshuafolkken/kit#8674: bttf's rows do not type, so its area opens on the live board's own flag.
	it('hands the bttf flux on a live board whose rows do not type', () => {
		vi.stubEnv('FORCE_COLOR', '3')
		const bttf = { ...MATRIX, theme: 'bttf' as const, types_rows: false, is_live: true }

		expect(panel_of(bttf, { area })).toStrictEqual({
			painter: run_board_flux_panel.FLUX_PAINTER,
			area,
		})
	})

	it.each([
		['no theme', { ...MATRIX, theme: undefined }],
		['the bttf theme off a live board', { ...MATRIX, theme: 'bttf' as const, types_rows: false }],
		[ONCE, { ...MATRIX, is_tty: false }],
	])('hands none with %s', (_, ports) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(panel_of(ports, { area })).toBeUndefined()
	})

	it('hands none on a terminal drawing no color, or with no area out', () => {
		vi.stubEnv('FORCE_COLOR', '0')

		expect(panel_of(MATRIX, { area })).toBeUndefined()
		vi.stubEnv('FORCE_COLOR', '3')

		expect(panel_of(MATRIX, { area: undefined })).toBeUndefined()
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

// A live redraw of a frame in `theme`, on a terminal drawing color and opened at the redraw: the state
// its turns carry.
function redrawn_state(
	theme: Theme,
	{ drop, flash }: { drop?: DropScreen; flash?: BoardState['flash'] } = {},
): BoardState {
	vi.stubEnv('FORCE_COLOR', '3')
	const { LOCAL, START, drawn_from, harness, plan_titled } = run_board_fixture
	const { FRESH_STATE, layout_for } = run_board_tick
	const { ports } = harness(LOCAL, [])
	const plan = plan_titled('a')
	const state = { ...FRESH_STATE, plan, run_started_ms: LOCAL.started_ms, drop, flash }
	const live = { ...ports, types_rows: true, theme, size, opened_ms: START }
	const redraw = { ports: live, now_ms: START }

	return drawn_from(state, LOCAL, redraw, layout_for(state, LOCAL, START))
}

// Whether rows decode on the redraw's turns.
function redrawn(theme: Theme): { is_decoding: boolean } {
	const drawn = redrawn_state(theme)

	return { is_decoding: drawn.typing?.is_decoding === true }
}

function screen_texts(drop: DropScreen | undefined): Array<string> {
	return (drop?.rows ?? []).map((row) => row.map((cell) => cell.text).join(''))
}

describe('run_board_tick_draw.draw_display with the entry', () => {
	it('keeps the decoding for the matrix board’s turns', () => {
		expect(redrawn('matrix')).toStrictEqual({ is_decoding: true })
	})

	it('keeps none for the wargames board’s turns', () => {
		expect(redrawn('wargames')).toStrictEqual({ is_decoding: false })
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

// joshuafolkken/kit#8369: a redraw carries the last frame's pour spans on while a drop they sped up can
// still be on screen, so the drops neither jump back up nor vanish mid-fall; an older span is let go.
// The pour spans the matrix board's next redraw keeps, the last frame having carried `span`.
function last_drop(): DropScreen {
	const last = redrawn_state('matrix').drop

	if (last === undefined) throw new Error('the matrix board drew no drop')

	return last
}

function carried(span: TypingSpan): ReadonlyArray<TypingSpan> {
	return redrawn_state('matrix', { drop: { ...last_drop(), pours: [span] } }).drop?.pours ?? []
}

describe('run_board_tick_draw.draw_display with the last frame’s pours', () => {
	const { START } = run_board_fixture
	const RECENT = { from_ms: START - 2000, to_ms: START - 1500 }
	const STALE = { from_ms: START - 3_600_000, to_ms: START - 3_599_000 }

	it('keeps a span a drop it sped up can still be on screen for', () => {
		expect(carried(RECENT)).toContainEqual(RECENT)
	})

	it('lets go of a span older than the slowest drop’s time on screen', () => {
		expect(carried(STALE)).not.toContainEqual(STALE)
	})
})

// joshuafolkken/kit#8629: a redraw carries the last frame's deja vu rains on the same way.
function carried_deja(span: TypingSpan): ReadonlyArray<TypingSpan> {
	return (
		redrawn_state('matrix', { drop: { ...last_drop(), deja_spans: [span] } }).drop?.deja_spans ?? []
	)
}

// The matrix board's flash, replaying its first row from the fixture's start.
function replaying_flash(): NonNullable<BoardState['flash']> {
	const { flash } = redrawn_state('matrix')
	const key = flash?.lines[0]?.key

	if (flash === undefined || key === undefined) throw new Error('the matrix board flashed no row')

	return { ...flash, deja_vu: [{ key, start_ms: run_board_fixture.START }] }
}

describe('run_board_tick_draw.draw_display with the last frame’s deja vu rains', () => {
	const { START } = run_board_fixture
	const RECENT = { from_ms: START - 2000, to_ms: START - 1000 }
	const STALE = { from_ms: START - 3_600_000, to_ms: START - 3_599_000 }

	it('keeps a deja vu’s rain while its drops can still be on screen', () => {
		expect(carried_deja(RECENT)).toStrictEqual([RECENT])
	})

	it('lets go of one older than the slowest drop’s time on screen', () => {
		expect(carried_deja(STALE)).toStrictEqual([])
	})

	it('keeps the end of a rain two deja vus merged, past one deja vu’s second', () => {
		const MERGED = { from_ms: START - 2000, to_ms: START - 500 }

		expect(carried_deja(MERGED)).toStrictEqual([MERGED])
	})

	it('starts a rain from the first frame of a row the flash replays', () => {
		const flash = replaying_flash()

		expect(redrawn_state('matrix', { drop: last_drop(), flash }).drop?.deja_spans).toStrictEqual([
			{
				from_ms: START,
				to_ms: START + run_board_rain_drop.DEJA_STEPS * run_board_rain_drop.DROP_MS,
			},
		])
	})
})
