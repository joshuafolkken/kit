import { describe, expect, it } from 'vitest'
import { run_board_fit, type PlanLine } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lanes, type LaneCells } from './run-board-render-lanes'
import type { UsageFigure } from './run-board-usage'

// joshuafolkken/kit#4171: each lane row draws its CPU, MEM and CMPRS cells after its number, under a
// rule whose labels stand over them.

const { COLUMN_LABELS, LANES_LABEL, lane_cells_of, lanes_section, number_text } =
	run_board_render_lanes
const { GB, board_usage, header } = run_board_render_fixture
const LANE = 42
const SCREEN_GAUGE = 5
const FIGURE: UsageFigure = { cpu_cores: 1.8, memory_bytes: 0.7 * GB, compressed_bytes: 0.6 * GB }
const LINE: PlanLine = { text: '  1', row: { stage: 'running', at_ms: 1 } }
const CELLS: LaneCells = {
	usages: new Map([[LANE, FIGURE]]),
	scale: { cores: 10, total_bytes: 16 * GB },
	gauge: 0,
	number_width: 8,
}
// Where the lanes rule leaves the CPU label room over the first cell: `── 🧵 lanes ─ `.
const LEAD_ROOM = 8
const LONG_LANE = 123_456_789

function row_of(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: 'Title', kind: undefined, state, status: undefined, waits: [] }
}

function plain(text: string): string {
	return text
}

function bracketed(text: string): string {
	return `<${text}>`
}

describe('run_board_render_lanes.number_text', () => {
	it('pads the number and draws the running row its figures, each right-aligned in its column', () => {
		expect(number_text(row_of(LANE, 'running'), CELLS, plain)).toBe(
			'42            1.8     0.7G       0.6G',
		)
	})

	it('draws blanks of the same width for a row that is not running', () => {
		const running = number_text(row_of(LANE, 'running'), CELLS, plain)

		expect(number_text(row_of(LANE, 'waiting'), CELLS, plain)).toBe(
			`42${' '.repeat(running.length - 2)}`,
		)
	})

	it('draws the linked number alone where no cells are drawn', () => {
		expect(number_text(row_of(LANE, 'running'), undefined, bracketed)).toBe('<42>')
	})
})

describe('run_board_render_lanes.lanes_section', () => {
	it('draws no section without lines', () => {
		expect(lanes_section([], CELLS)).toStrictEqual([])
	})

	it('heads the lines with a blank line where no cells are drawn', () => {
		expect(lanes_section([LINE], undefined)).toStrictEqual([{ head: [''], lines: [LINE] }])
	})

	it('heads the lines with a rule whose labels stand over the cells', () => {
		const [section] = lanes_section([LINE], CELLS)
		const rule = section?.head[1] ?? ''
		const cpu = run_board_fit.width_of('  🔄 ') + CELLS.number_width + 1
		const before_cpu = rule.slice(0, rule.indexOf('💪 CPU'))

		expect(rule.startsWith('── 🧵 lanes ')).toBe(true)
		expect(run_board_fit.width_of(before_cpu)).toBe(cpu)
	})

	// joshuafolkken/kit#4223: a text-default icon is counted one column wide but drawn two.
	it('marks the rule and its columns with icons two columns wide', () => {
		const icons = [LANES_LABEL, ...COLUMN_LABELS].map((label) => label.split(' ', 1)[0] ?? '')

		expect(icons.map((icon) => run_board_fit.width_of(icon))).toStrictEqual([2, 2, 2, 2])
	})
})

describe('run_board_render_lanes.lane_cells_of', () => {
	it('draws no cells where the frame read no usage', () => {
		expect(lane_cells_of(header(), [row_of(LANE, 'running')])).toBeUndefined()
	})

	it('draws figures alone where the frame draws no spinner, the numbers padded to the rule', () => {
		const board = header({ usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [row_of(LANE, 'running'), row_of(7, 'waiting')])).toMatchObject({
			gauge: 0,
			number_width: LEAD_ROOM,
		})
	})

	it('pads the numbers to the widest where it is wider than the rule needs', () => {
		const board = header({ usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [row_of(LONG_LANE, 'running')])?.number_width).toBe(
			String(LONG_LANE).length,
		)
	})

	it('draws gauges on a terminal', () => {
		const board = header({ spinner: '⠋', usages: board_usage(new Map()) })

		expect(lane_cells_of(board, [])?.gauge).toBe(SCREEN_GAUGE)
	})
})
