import { describe, expect, it } from 'vitest'
import { run_board_flux_panel } from './run-board-flux-panel'
import { run_board_lamp_spots } from './run-board-lamp-spots'
import { run_board_paint_fixture } from './run-board-paint-fixture'
import {
	run_board_panel_draw,
	type PanelArea,
	type PanelCell,
	type PanelMoment,
} from './run-board-panel-draw'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#8674: the bttf painter of the animation area — the speed readout in the throughput
// rule, the figure right-aligned at the rule's end over the usage rule, and only the lamp places blanked
// where the figure does not fit.

const { FIGURE_WIDTH, FLUX_PAINTER, speed_text } = run_board_flux_panel
const { PANEL_TICK_MS, area_of, panel_bytes } = run_board_panel_draw
const { rgb_of } = run_board_paint_fixture
const PANEL = Array.from({ length: 8 }, () => run_board_spot.LAMP).join(' ')
const ROWS = [`  24h  5  ${PANEL}`, `   7d     ${PANEL}`]
const USAGE = ['', '── usage ──', '  Claude', '  Codex', '  GitHub']
const STARTS = [1, 2, 3]
const WIDE_END = 100
const USAGE_ROW = 4
const SPEED_OFFSET = 3
const AT = { ms: 0, is_burst: false }
const FIGURE_ROWS = 7
const JUMP = { start_ms: 0, letters: 30 }
// The jump itself: the last letter typed, on an even panel tick.
const JUMP_MS = JUMP.letters * PANEL_TICK_MS

function area_with(rule: string, usage = USAGE): PanelArea {
	const lines = [rule, ...ROWS, ...usage, '', '── lanes ──']
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

// joshuafolkken/kit#8712: seven rows under the rule, through the GitHub row, and none past it.
describe('run_board_flux_panel.FLUX_PAINTER rows', () => {
	it('covers seven rows under the rule across the figure, idle and flooded', () => {
		const flooded = { ms: JUMP_MS, is_burst: false, jump: JUMP }

		for (const at of [AT, flooded]) {
			const cells = FLUX_PAINTER.cells(WIDE, at)
			const below = cells.filter((cell) => cell.row > WIDE.top && cell.column >= LEFT)

			expect(new Set(below.map((cell) => cell.row - WIDE.top))).toStrictEqual(
				new Set([1, 2, 3, 4, 5, 6, 7]),
			)
			expect(new Set(below.map((cell) => `${String(cell.row)} ${String(cell.column)}`)).size).toBe(
				FIGURE_ROWS * FIGURE_WIDTH,
			)
		}
	})

	it('blanks only the lamp places before the GitHub row is drawn', () => {
		const short = area_with('─'.repeat(WIDE_END), USAGE.slice(0, -1))

		expect(FLUX_PAINTER.cells(short, AT)).toStrictEqual(
			short.lamps.map((lamp) => ({ row: lamp.row, column: lamp.column, text: ' ' })),
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

// joshuafolkken/kit#8677: the figure through a jump and through the arrival — the speed at 88 blinking
// white, the capacitor flooded, and back to cruising once each is over.

const ARRIVE_OVER_MS = 3200
const TOP_WHITE = '255;255;255'

function speed_cell(at: PanelMoment): PanelCell | undefined {
	return cell_at(FLUX_PAINTER.cells(WIDE, at), WIDE.top, LEFT + SPEED_OFFSET)
}

// The grounds the cells stand on.
function grounds(cells: ReadonlyArray<PanelCell>): Set<string | undefined> {
	return new Set(cells.map((cell) => rgb_of(cell.bg)))
}

describe('run_board_flux_panel.FLUX_PAINTER through a jump', () => {
	it('reads 88 at the jump, white on every other tick', () => {
		const even = speed_cell({ ms: JUMP_MS, is_burst: false, jump: JUMP })
		const odd = speed_cell({ ms: JUMP_MS + PANEL_TICK_MS, is_burst: false, jump: JUMP })

		expect(even).toMatchObject({ text: ' 88.0 ', fg: { rgb: TOP_WHITE } })
		expect(odd?.text).toBe(' 88.0 ')
		expect(rgb_of(odd?.fg)).not.toBe(TOP_WHITE)
	})

	it('floods the capacitor at the jump, unlike the same moment cruising', () => {
		const at = { ms: JUMP_MS, is_burst: false }
		const jumping = grounds(FLUX_PAINTER.cells(WIDE, { ...at, jump: JUMP }))
		const cruising = grounds(FLUX_PAINTER.cells(WIDE, at))

		expect([...jumping].filter((ground) => !cruising.has(ground))).not.toHaveLength(0)
	})

	it('arrives at 88 and cruises as before once the arrival is over', () => {
		const over = { ms: ARRIVE_OVER_MS, is_burst: false }

		expect(speed_cell({ ms: 0, is_burst: false, arrive_ms: 0 })?.text).toBe(' 88.0 ')
		expect(speed_cell({ ...over, arrive_ms: 0 })).toStrictEqual(speed_cell(over))
	})
})
