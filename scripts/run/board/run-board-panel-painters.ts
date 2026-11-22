import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_lamps } from './run-board-lamps'
import type { PanelArea, PanelCell, PanelMoment, PanelPainter } from './run-board-panel-draw'

// joshuafolkken/kit#8676: the two themes' painters of the animation area (`run-board-panel-draw.ts`), each
// drawing the frame's lamp places as before — the wargames lamps blinking once the rows are typed
// (joshuafolkken/kit#8236), the matrix idle rain from the first frame (joshuafolkken/kit#8356).

const { is_lit, lamp_text } = run_board_lamps

function lamp_cells(area: PanelArea, at: PanelMoment): ReadonlyArray<PanelCell> {
	return area.lamps.map((lamp) => ({
		row: lamp.row,
		column: lamp.column,
		text: lamp_text(lamp.panel_row, is_lit(at.ms, lamp.group, lamp.lamp, at.is_burst)),
	}))
}

function rain_cells(area: PanelArea, at: PanelMoment): ReadonlyArray<PanelCell> {
	return area.lamps.map((lamp) => ({
		row: lamp.row,
		column: lamp.column,
		text: run_board_idle_rain.cell_text(lamp, at),
	}))
}

const LAMP_PAINTER: PanelPainter = { is_idle: false, is_ticking: false, cells: lamp_cells }
const RAIN_PAINTER: PanelPainter = { is_idle: true, is_ticking: false, cells: rain_cells }

const run_board_panel_painters = { LAMP_PAINTER, RAIN_PAINTER }

export { run_board_panel_painters }
