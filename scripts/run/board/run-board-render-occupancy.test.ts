import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lanes } from './run-board-render-lanes'
import { run_board_render_lead } from './run-board-render-lead'
import { run_board_render_processes } from './run-board-render-processes'

const { EMPTY_LAYOUT, NOW, board_usage, header } = run_board_render_fixture
const { lanes_section } = run_board_render_lanes
const { ELAPSED_START, USAGE_START, column_offset, lead_of } = run_board_render_lead
const LINE = { text: 'lane', row: undefined }
const USED = 12
const LIMIT = 24
const NARROW = 70
const ROW = {
	number: 5465,
	title: 'A long lane title that must fit the terminal',
	kind: undefined,
	state: 'running' as const,
	status: {
		state: 'running' as const,
		started_ms: NOW,
		phase_ms: NOW,
		track: ['implement' as const],
	},
	waits: [],
}

function column_of(line: string, marker: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

describe('run board lane occupancy', () => {
	it.each([
		{ occupied_count: 2, lane_limit: 6, label: '2/6' },
		{ occupied_count: 0, lane_limit: 6, label: '0/6' },
		{ occupied_count: 2, lane_limit: undefined, label: '2/—' },
		{ occupied_count: USED, lane_limit: LIMIT, label: '12/24' },
	])('draws the capacity reading $label', ({ occupied_count, lane_limit, label }) => {
		const board = header({ occupied_count, lane_limit })
		const [section] = lanes_section([LINE], undefined, board)

		expect(section?.label).toBe(`🧵 lanes ${label}`)
		expect(section?.head[1]).toContain(`🧵 lanes ${label}`)
	})
})

describe('run board lane occupancy columns', () => {
	it('moves the elapsed and usage columns together for multiple digit counts', () => {
		const board = header({ occupied_count: USED, lane_limit: LIMIT })
		const cells = run_board_render_lanes.lane_cells_of(
			{ ...board, usages: board_usage(new Map()) },
			[],
		)
		const rule = lanes_section([LINE], cells, board)[0]?.head[1] ?? ''
		const lead = `  ${lead_of(ROW, board)} `

		expect(column_of(rule, '⏰')).toBe(ELAPSED_START + column_offset(board))
		expect(column_of(rule, '💪 CPU')).toBe(USAGE_START + column_offset(board))
		expect(run_board_fit.width_of(lead)).toBe(column_of(rule, '💪 CPU'))
	})

	it('keeps process cells in the same columns without adding occupancy to their lanes label', () => {
		const board = header({
			occupied_count: USED,
			lane_limit: LIMIT,
			spinner: '⠋',
			usages: board_usage(new Map()),
		})
		const part = run_board_render_processes.processes_part(board)

		if (part === undefined) throw new Error('Missing processes')

		const rule = part.head[1] ?? ''
		const line = part.lines[0]?.text ?? ''

		expect(column_of(rule, '💪 CPU')).toBe(USAGE_START + column_offset(board))
		expect(column_of(line, '0.0')).toBeGreaterThanOrEqual(column_of(rule, '💪 CPU'))
		expect(part.lines.map((entry) => entry.text).join('\n')).not.toContain('12/24')
	})
})

describe('run board lane occupancy width', () => {
	it('keeps the occupied heading and lane within a narrow frame', () => {
		const board = header({
			occupied_count: USED,
			lane_limit: LIMIT,
			layout: { ...EMPTY_LAYOUT, active: [ROW] },
		})
		const lines = run_board_render.render({
			header: board,
			notes: [],
			size: { columns: NARROW, rows: 50 },
		})

		expect(lines.join('\n')).toContain('🧵 lanes 12/24')
		const lane_lines = lines.filter((line) => /lanes|5465/u.test(line))

		expect(lane_lines).toHaveLength(2)
		for (const line of lane_lines) expect(run_board_fit.width_of(line)).toBeLessThanOrEqual(NARROW)
	})
})
