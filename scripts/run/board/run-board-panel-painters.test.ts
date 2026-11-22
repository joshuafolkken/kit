import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_flux_panel } from './run-board-flux-panel'
import { run_board_idle_rain } from './run-board-idle-rain'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_lamps } from './run-board-lamps'
import { run_board_panel_draw, type PanelMoment, type PanelPainter } from './run-board-panel-draw'
import { run_board_panel_painters } from './run-board-panel-painters'
import { run_board_spot } from './run-board-spot'
import { run_board_theme_defs } from './run-board-theme-defs'

// joshuafolkken/kit#8676: the wargames lamps and the matrix idle rain drawn as the themes' painters of the
// animation area, byte for byte as the lamp panel's own writes drew them.

const { LAMP_PAINTER, RAIN_PAINTER } = run_board_panel_painters
const { area_of, panel_bytes } = run_board_panel_draw
const { LAMP } = run_board_spot
const START = Date.parse('2026-11-22T09:00:00.000Z')
const CSI = '\u{1B}['
const PANEL = Array.from({ length: 8 }, () => LAMP).join(' ')
const LINES = ['── throughput ──', `  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
const LAMPS = run_board_lamp_spots.lamps_in(LINES, [1, 2, 3], 80)
const MOMENTS: ReadonlyArray<PanelMoment> = [0, 80, 160, 1000].flatMap((offset) => [
	{ ms: START + offset, is_burst: false },
	{ ms: START + offset, is_burst: true },
])

type CellText = (lamp: (typeof LAMPS)[number], at: PanelMoment) => string

afterEach(() => {
	vi.unstubAllEnvs()
})

function lamp_text(lamp: (typeof LAMPS)[number], at: PanelMoment): string {
	const { is_lit } = run_board_lamps

	return run_board_lamps.lamp_text(
		lamp.panel_row,
		is_lit(at.ms, lamp.group, lamp.lamp, at.is_burst),
	)
}

// The bytes the lamp panel wrote before the painters: each lamp's cell as `text` draws it, at its place.
function former_bytes(text: CellText, at: PanelMoment): string {
	return LAMPS.map(
		(lamp) => `${CSI}${String(lamp.row)};${String(lamp.column)}H${text(lamp, at)}`,
	).join('')
}

function painted_bytes(painter: PanelPainter, at: PanelMoment): string {
	const area = area_of(LINES, [1, 2, 3], LAMPS)

	return area === undefined ? '' : panel_bytes({ painter, area }, at, undefined)
}

describe('run_board_panel_painters.LAMP_PAINTER', () => {
	it.each(MOMENTS)('draws the wargames lamps as before at %o', (at) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(painted_bytes(LAMP_PAINTER, at)).toBe(former_bytes(lamp_text, at))
	})

	it('waits for the rows to be typed and wakes on no step of its own', () => {
		expect(LAMP_PAINTER).toMatchObject({ is_idle: false, is_ticking: false })
	})
})

describe('run_board_panel_painters.RAIN_PAINTER', () => {
	it.each(MOMENTS)('draws the matrix idle rain as before at %o', (at) => {
		vi.stubEnv('FORCE_COLOR', '3')

		expect(painted_bytes(RAIN_PAINTER, at)).toBe(former_bytes(run_board_idle_rain.cell_text, at))
	})

	it('runs from the first frame and wakes on no step of its own', () => {
		expect(RAIN_PAINTER).toMatchObject({ is_idle: true, is_ticking: false })
	})
})

// joshuafolkken/kit#8712: the bttf area reaching a row lower leaves the other themes' cells as they were.
describe('run_board_panel_painters on the taller area', () => {
	it.each([LAMP_PAINTER, RAIN_PAINTER])(
		'draws the same cells over seven rows as over eight',
		(painter) => {
			vi.stubEnv('FORCE_COLOR', '3')
			const area = area_of(LINES, [1, 2, 3], LAMPS)

			if (area === undefined) throw new Error('no area')

			const at = { ms: START, is_burst: false }

			expect(painter.cells({ ...area, rows: 8 }, at)).toStrictEqual(
				painter.cells({ ...area, rows: 7 }, at),
			)
		},
	)
})

describe('run_board_theme_defs.panel_of', () => {
	it('hands the wargames lamps, the matrix rain and the bttf flux, and nothing in no theme', () => {
		const { panel_of } = run_board_theme_defs

		expect(panel_of('wargames')).toBe(LAMP_PAINTER)
		expect(panel_of('matrix')).toBe(RAIN_PAINTER)
		expect(panel_of('bttf')).toBe(run_board_flux_panel.FLUX_PAINTER)
		expect(panel_of(undefined)).toBeUndefined()
	})
})
