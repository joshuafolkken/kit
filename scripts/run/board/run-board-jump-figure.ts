import { run_board_jump } from './run-board-jump'
import { run_board_jump_paint, type PaintCell } from './run-board-jump-paint'
import type { Paint, TextColor } from './run-board-labels'
import type { PanelCell, PanelMoment } from './run-board-panel-draw'
import { run_board_rgb, type Rgb } from './run-board-rgb'

// joshuafolkken/kit#8677: the animation area's own cells — the capacitor and the gauge — through the
// bttf jump and arrival. They keep their own light through the run up and the wash, thaw from ice with
// the rest of the board, and go dark and flash with it on the arrival. A cell with no 24-bit color of
// its own is left as it is.

const { arrive_cells, jump_cells } = run_board_jump_paint
const { TICK_MS, tick_of } = run_board_jump
const { parsed, shade_of } = run_board_rgb

// A cell's 24-bit color and its palette fallback.
interface ShadeRgb {
	rgb: Rgb
	named: TextColor
}

function shade_rgb(paint: Paint | undefined): ShadeRgb | undefined {
	if (typeof paint !== 'object' || Array.isArray(paint) || !('rgb' in paint)) return undefined

	return { rgb: parsed(paint.rgb), named: paint.named }
}

// The cells through a moment's light: the jump's or the arrival's, as they are with neither.
function lit_of(
	cells: ReadonlyArray<PaintCell>,
	at: PanelMoment,
): ReadonlyArray<PaintCell> | undefined {
	if (at.jump !== undefined) {
		return jump_cells(cells, tick_of(at.jump, at.ms), at.jump.letters, { rows: 0 })
	}

	if (at.arrive_ms === undefined) return undefined

	return arrive_cells(cells, Math.floor((at.ms - at.arrive_ms) / TICK_MS))
}

// The painter's cells at a moment, each 24-bit one lit as the jump or the arrival lights the board.
function figure_look(cells: ReadonlyArray<PanelCell>, at: PanelMoment): ReadonlyArray<PanelCell> {
	const shades = cells.map((cell) => shade_rgb(cell.fg))
	const paint = cells.map((cell, index) => ({
		x: cell.column - 1,
		y: cell.row - 1,
		text: cell.text,
		fg: shades[index]?.rgb ?? parsed('0;0;0'),
		is_figure: true,
	}))
	const lit = lit_of(paint, at)

	if (lit === undefined) return cells

	return cells.map((cell, index) => {
		const shade = shades[index]
		const rgb = lit[index]?.fg

		return shade === undefined || rgb === undefined
			? cell
			: { ...cell, fg: shade_of(rgb, shade.named) }
	})
}

const run_board_jump_figure = { figure_look }

export { run_board_jump_figure }
