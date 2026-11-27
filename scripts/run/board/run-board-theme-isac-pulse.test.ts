import { describe, expect, it } from 'vitest'
import { run_board_theme_draw } from './run-board-theme-draw'
import { run_board_theme_isac_data } from './run-board-theme-isac-data'
import { run_board_theme_isac_pulse } from './run-board-theme-isac-pulse'
import { run_board_theme_rk800_fixture } from './run-board-theme-rk800-fixture'

// joshuafolkken/kit#9096: the isac theme's ROW — when the pulse sweeps, the label it leaves in the
// area, and the lane's mark that turns white as a ring crosses it.

const { activation, is_activating, lane_mark } = run_board_theme_isac_pulse
const { INKS, PULSE } = run_board_theme_isac_data
const { area_pane } = run_board_theme_draw
const { HOST, draw_at, fresh_grid, row_text, state_at } = run_board_theme_rk800_fixture
const STARTED = 10
const SWEEPING = 40
const BLINK_DARK = 18
const BEFORE_CROSS = 0
const AFTER_PULSE = 400

const MARK_OFFSET = 2

function lane_cells(tick: number): { mark: string; style: string; lane_style: string } {
	const draw = draw_at('r', tick)
	const { y, x } = state_at('r', tick).row.span

	lane_mark(draw)

	const row = draw.grid[y] ?? []
	const [mark, style] = row[x - MARK_OFFSET] ?? ['', '']
	const [, lane_style] = row[x] ?? ['', '']

	return { mark, style, lane_style }
}

describe('run_board_theme_isac_pulse.is_activating', () => {
	it('plays while the new lane types and for the pulse’s tail', () => {
		expect(is_activating(state_at('r', 0))).toBe(false)
		expect(is_activating(state_at('r', SWEEPING))).toBe(true)
		expect(is_activating(state_at('r', AFTER_PULSE))).toBe(false)
		expect(is_activating(state_at('i', SWEEPING))).toBe(false)
	})
})

describe('run_board_theme_isac_pulse.activation', () => {
	it('fills the area with the field and labels the lane', () => {
		const draw = draw_at('r', SWEEPING)
		const rows = area_pane(draw).box

		activation(draw)

		expect(row_text(draw.grid, rows.y + 1)).toContain(`◆ AGENT ACTIVATED #${HOST.layout.new_lane}`)
		expect(row_text(draw.grid, rows.y)).toContain('·')
	})

	it('writes the label white, blinking dark while the lane types', () => {
		const lit = draw_at('r', SWEEPING + STARTED)
		const dark = draw_at('r', STARTED + BLINK_DARK)
		const at = HOST.layout.area_top + 1 + PULSE.label_row

		activation(lit)
		activation(dark)

		expect([
			lit.grid[at]?.[PULSE.label_x + 1]?.[1],
			dark.grid[at]?.[PULSE.label_x + 1]?.[1],
		]).toStrictEqual([INKS.WHITE, INKS.ORANGE])
	})
})

describe('run_board_theme_isac_pulse.lane_mark', () => {
	it('marks the lane in orange before a ring crosses it', () => {
		const cells = lane_cells(STARTED + BEFORE_CROSS)

		expect(cells.mark).toBe('◆')
		expect(cells.style).toBe(INKS.ORANGE)
	})

	it('turns the mark and the lane’s letters white as a ring crosses', () => {
		const cells = lane_cells(STARTED + PULSE.cross_from)

		expect(cells.style).toBe(INKS.WHITE)
		expect(cells.lane_style).toBe(INKS.WHITE)
	})

	it('leaves the board alone when no pulse plays', () => {
		const draw = draw_at('i', SWEEPING)

		lane_mark(draw)

		expect(draw.grid).toStrictEqual(fresh_grid())
	})
})
