import { describe, expect, it } from 'vitest'
import { run_board_flux_panel } from './run-board-flux-panel'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_panel_draw, type PanelArea, type PanelCell } from './run-board-panel-draw'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8674: the bttf painter of the animation area — the speed readout in the throughput
// rule, the figure right-aligned at the rule's end over the usage rule, and only the lamp places blanked
// where the figure does not fit.

const { FIGURE_WIDTH, FLUX_PAINTER, speed_text } = run_board_flux_panel
const { PANEL_TICK_MS, area_of, panel_bytes } = run_board_panel_draw
const PANEL = Array.from({ length: 8 }, () => run_board_spot.LAMP).join(' ')
const ROWS = [`  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
const STARTS = [1, 2, 3]
const WIDE_END = 100
const USAGE_ROW = 4
const SPEED_OFFSET = 3
const AT = { ms: 0, is_burst: false }

function area_with(rule: string): PanelArea {
	const lines = [rule, ...ROWS]
	const lamps = run_board_lamp_spots.lamps_in(lines, STARTS, WIDE_END)
	const area = area_of(lines, STARTS, lamps)

	if (area === undefined) throw new Error('no area')

	return area
}

const WIDE = area_with('─'.repeat(WIDE_END))
const NARROW = area_with('── throughput ──')
const LEFT = WIDE.end - FIGURE_WIDTH + 1

function cell_at(
	cells: ReadonlyArray<PanelCell>,
	row: number,
	column: number,
): PanelCell | undefined {
	return cells.findLast((cell) => cell.row === row && cell.column === column)
}

describe('run_board_flux_panel.FLUX_PAINTER cells', () => {
	it('writes the idle speed in the throughput rule three columns into the capacitor', () => {
		const cells = FLUX_PAINTER.cells(WIDE, AT)

		expect(speed_text(0)).toBe(' 28.0 ')
		expect(cell_at(cells, WIDE.top, LEFT + SPEED_OFFSET)?.text).toBe(' 28.0 ')
	})

	it('covers the usage rule from the figure left to the rule end', () => {
		const cells = FLUX_PAINTER.cells(WIDE, AT)
		const covered = Array.from({ length: FIGURE_WIDTH }, (_, offset) =>
			cell_at(cells, WIDE.top + USAGE_ROW, LEFT + offset),
		)

		expect(covered.every((cell) => cell !== undefined)).toBe(true)
		expect(LEFT + FIGURE_WIDTH - 1).toBe(WIDE.end)
	})

	it('blanks only the lamp places where the figure would reach into the throughput rows', () => {
		const cells = FLUX_PAINTER.cells(NARROW, AT)

		expect(cells).toStrictEqual(
			NARROW.lamps.map((lamp) => ({ row: lamp.row, column: lamp.column, text: ' ' })),
		)
	})
})

describe('run_board_flux_panel.FLUX_PAINTER timing', () => {
	it('runs from the first frame and wakes on its own tick', () => {
		expect(FLUX_PAINTER).toMatchObject({ is_idle: true, is_ticking: true })
	})

	it('writes nothing again within one tick', () => {
		const draw = { painter: FLUX_PAINTER, area: WIDE }
		const later = { ms: PANEL_TICK_MS - 1, is_burst: false }

		expect(panel_bytes(draw, later, AT)).toBe('')
		expect(panel_bytes(draw, AT, undefined)).not.toBe('')
	})
})
