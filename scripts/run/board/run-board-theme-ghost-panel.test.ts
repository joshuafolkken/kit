import { describe, expect, it } from 'vitest'
import { run_board_theme_draw, type Pane, type ThemeDraw } from './run-board-theme-draw'
import { run_board_theme_ghost_data } from './run-board-theme-ghost-data'
import { run_board_theme_ghost_panel } from './run-board-theme-ghost-panel'
import { run_board_theme_host_fixture } from './run-board-theme-host-fixture'
import type { Grid, ThemeState } from './run-board-theme-host-types'
import { run_board_theme_magi_fixture } from './run-board-theme-magi-fixture'

// joshuafolkken/kit#9096: the ghost theme's panel.

const { is_diving, panel, spin_of, status_block, text_ring } = run_board_theme_ghost_panel
const { HOST } = run_board_theme_host_fixture
const { fresh_grid, state_at } = run_board_theme_magi_fixture
const { BLANK, panel_box } = run_board_theme_draw
const { DIVE, INKS, RING, STATUS } = run_board_theme_ghost_data
const TYPING = 20
const HOLD_END = 29
const SPIN_TICKS = 100
const PANE_W = 12
const PANE_H = 5

function draw_of(grid: Grid, state: ThemeState): ThemeDraw {
	return { api: HOST.api, grid, s: state, tick: state.tick }
}

function panel_rows(state: ThemeState, drawn: (draw: ThemeDraw) => void): Array<string> {
	const grid = fresh_grid()
	const box = panel_box(HOST.layout)

	drawn(draw_of(grid, state))

	return grid.slice(box.y, box.y + box.h).map((row) =>
		row
			.slice(box.x, box.x + box.w)
			.map(([ch]) => ch)
			.join(''),
	)
}

function blank_pane(): Pane {
	const grid = Array.from({ length: PANE_H }, () => Array.from({ length: PANE_W }, () => BLANK))

	return { grid, box: { x: 0, y: 0, w: PANE_W, h: PANE_H } }
}

// Whether a stream's cell is the blank after a hex pair: the first stream drifts right, the other left.
function is_stream_gap(stream: number, x: number): boolean {
	const position = x + (stream === 0 ? TYPING : -TYPING)

	return (((position % DIVE.pair) + DIVE.pair) % DIVE.pair) + 1 === DIVE.pair
}

describe('run_board_theme_ghost_panel.is_diving', () => {
	it('is true while a progress line types and for a moment after, not at idle', () => {
		expect(is_diving(state_at('p', TYPING))).toBe(true)
		expect(is_diving(state_at('p', 0))).toBe(false)
		expect(is_diving(state_at('i', TYPING))).toBe(false)
		expect(is_diving(state_at('p', 1000))).toBe(false)
	})
})

describe('run_board_theme_ghost_panel.spin_of', () => {
	it('turns slowly at rest and faster for every tick anything has typed', () => {
		const idle = spin_of(state_at('i', SPIN_TICKS), SPIN_TICKS)
		const busy = state_at('p', SPIN_TICKS)

		expect(idle).toBeCloseTo(SPIN_TICKS * RING.idle_pace)
		expect(spin_of(busy, SPIN_TICKS)).toBeGreaterThan(idle)
	})
})

describe('run_board_theme_ghost_panel.status_block', () => {
	it('reads the link, the barrier gauge and the sync reading', () => {
		const rows = panel_rows(state_at('i', 0), (draw) => {
			status_block(draw, 1)
		})

		expect(rows[STATUS.link_row]).toMatch(/^LINK\s+ACTIVE/u)
		expect(rows[STATUS.barrier_row]).toMatch(/^BARRIER\s+▮▯▯▯/u)
		expect(rows[STATUS.sync_row]).toMatch(/^SYNC\s+9[78]\.\d%/u)
	})

	it('reads the link as diving while anything types, and holds the sync reading', () => {
		const typing = panel_rows(state_at('p', TYPING), (draw) => {
			status_block(draw, STATUS.barrier_lit)
		})
		const first = panel_rows(state_at('i', 0), (draw) => {
			status_block(draw, 0)
		})
		const held = panel_rows(state_at('i', HOLD_END), (draw) => {
			status_block(draw, 0)
		})

		expect(typing[STATUS.link_row]).toContain('DIVING')
		expect(held[STATUS.sync_row]).toBe(first[STATUS.sync_row])
	})
})

describe('run_board_theme_ghost_panel.text_ring', () => {
	const center = { x: 5, y: 2 }
	const radius = { x: 4, y: 1 }

	it('writes its words from the top of the ellipse, clockwise', () => {
		const pane = blank_pane()

		text_ring(pane, { center, radius, spin: 0 })

		expect(pane.grid[center.y - radius.y]?.[center.x]).toStrictEqual(['N', INKS.CYAN])
		expect(pane.grid.flat().filter(([ch]) => ch !== ' ').length).toBeGreaterThan(1)
	})

	it('takes one ink for every letter where given', () => {
		const pane = blank_pane()

		text_ring(pane, { center, radius, spin: 0, ink: INKS.WHITE })

		const inks = new Set(
			pane.grid
				.flat()
				.filter(([ch]) => ch !== ' ')
				.map(([, ink]) => ink),
		)

		expect([...inks]).toStrictEqual([INKS.WHITE])
	})
})

describe('run_board_theme_ghost_panel.panel', () => {
	it('shows the status block, the ring and the graph’s lit node at idle', () => {
		const rows = panel_rows(state_at('i', 0), panel)

		expect(rows.join('\n')).toContain('BARRIER')
		expect(rows.join('\n')).toContain('●')
		expect(rows.join('\n')).toContain('N')
	})

	it('streams hex pairs sideways on two rows while diving, one each way', () => {
		const state = state_at('p', TYPING)
		const rows = panel_rows(state, panel)

		for (let index = 0; index < DIVE.streams; index++) {
			const row = rows[DIVE.stream_row + index] ?? ''

			for (let x = 0; x < DIVE.stream_w; x++) {
				expect(row.charAt(x) === ' ').toBe(is_stream_gap(index, x))
			}
		}
	})

	it('draws no stream at idle', () => {
		const rows = panel_rows(state_at('i', TYPING), panel)

		expect(rows[DIVE.stream_row]?.slice(0, DIVE.stream_w).trim()).toBe('')
	})
})
