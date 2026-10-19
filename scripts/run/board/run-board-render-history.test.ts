import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { LaneEvent } from './run-board-lane-event'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'

// joshuafolkken/kit#3526: a running row led by the phase it reached last, the lane's CPU and memory in
// one column. joshuafolkken/kit#3769: no phase track after them — a running row ends on how long it has
// stood at its phase and its newest activity, a settled row on its finish time.

const { EMPTY_LAYOUT, GB, MINUTE, NOW, board_usage, header, lines_of } = run_board_render_fixture
const { minute_of } = run_board_labels
// Each figure right-aligned in a column as wide as its label, the first after the number padded so the
// lanes rule leaves the CPU label room over it.
const CELLS = '     0.5     0.5G       0.0G'
const NUMBER_PAD = ' '.repeat(8)
const TITLE_WIDTH = 48

const PLANNED: ReadonlyArray<Phase> = ['investigate', 'plan']
const RETRIED: ReadonlyArray<Phase> = [
	'investigate',
	'plan',
	'implement',
	'ship',
	'failed',
	'implement',
	'ship',
	'review',
	'gate',
]
const FAILED: ReadonlyArray<Phase> = ['investigate', 'plan', 'implement', 'ship', 'failed']
const SHIPPED: ReadonlyArray<Phase> = [...RETRIED.slice(0, 4), 'review', 'gate', 'sync', 'report']

function running(number: number, track: ReadonlyArray<Phase>): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - 5 * MINUTE,
		track,
		phase_ms: NOW - 2 * MINUTE,
	}

	return {
		number,
		title: `Sample ${String(number)}`,
		kind: undefined,
		state: 'running',
		status,
		waits: [],
	}
}

const ROWS = [running(1, PLANNED), running(2, RETRIED), running(3, FAILED), running(4, SHIPPED)]

const usages = board_usage(
	new Map(
		ROWS.map((row) => [row.number, { cpu_cores: 0.5, memory_bytes: GB / 2, compressed_bytes: 0 }]),
	),
)

const GATE_EVENT: LaneEvent = { phase: 'gate', words: 'ship gate', at_ms: NOW - MINUTE }

function board_lines(): Array<string> {
	const activity = {
		last_event_ms: NOW - MINUTE,
		is_stopped: false,
		lane_events: new Map([[2, GATE_EVENT]]),
	}

	return lines_of(header({ layout: { ...EMPTY_LAYOUT, active: ROWS }, usages, activity }))
}

function row_line(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`Sample ${String(number)}`)) ?? ''
}

describe('run_board_render.render running rows', () => {
	it('leads every running row with the last phase it reached, and draws no track after it', () => {
		const lines = board_lines()

		expect(row_line(lines, 1)).toMatch(/^ {2}📝 1 .* 2′00″$/u)
		expect(row_line(lines, 3)).toMatch(/^ {2}💥 3 .* 2′00″$/u)
		expect(row_line(lines, 4)).toMatch(/^ {2}📣 4 .* 2′00″$/u)
		expect(lines.join('\n')).not.toContain('🔍📝')
	})

	it('draws no dim line on any running row', () => {
		const rows = ROWS.map((row) => row_line(board_lines(), row.number))

		expect(rows.every((line) => !line.includes('─'))).toBe(true)
	})

	it('keeps the CPU, MEM and CMPRS in one column on every running row', () => {
		const lines = board_lines()
		const columns = ROWS.map((row) => row_line(lines, row.number).indexOf(CELLS))

		expect(columns[0]).toBeGreaterThan(0)
		expect(new Set(columns).size).toBe(1)
	})

	it('draws a row as the reference does: lead, number, usage, title, time, phase time, activity', () => {
		const title = 'Sample 2'.padEnd(TITLE_WIDTH)

		expect(row_line(board_lines(), 2)).toBe(
			`  🚦 2${NUMBER_PAD}${CELLS}    ${title}  5′00″  🚦 2′00″ · 🚦 1′00″`,
		)
	})
})

// Row 1 settled as `state` after `track`, on a board that still holds a usage reading for its lane.
function settled_line(state: ItemState, track: ReadonlyArray<Phase>): string {
	const status = { state, started_ms: NOW - 5 * MINUTE, ended_ms: NOW, track }
	const row: BoardRow = { number: 1, title: 'Sample 1', kind: undefined, state, status, waits: [] }

	return row_line(lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [row] }, usages })), 1)
}

// joshuafolkken/kit#3535: a settled row leads with its own state icon — it runs no process, so it draws
// no CPU or memory; a finished one draws its finish time in their place (joshuafolkken/kit#3554), and
// nothing after it (joshuafolkken/kit#3769).
describe('run_board_render.render settled rows', () => {
	const title = 'Sample 1'.padEnd(TITLE_WIDTH)

	it.each<[ItemState, string]>([
		['merged', '✅'],
		['done', '🏁'],
	])('ends a %s row on its finish time', (state, icon) => {
		const finish = `🔚 ${minute_of(NOW)}`

		expect(settled_line(state, FAILED)).toBe(`  ${icon} 1    ${title}  5′00″  ${finish}`)
	})

	// joshuafolkken/kit#4171: a lane no child works in blanks its CPU, MEM and CMPRS.
	it.each<[ItemState, string]>([
		['stopped', '🛑'],
		['parked', '💤'],
	])('ends a %s row on its time, its usage blank', (state, icon) => {
		const blank = ' '.repeat(CELLS.length)

		expect(settled_line(state, FAILED)).toBe(`  ${icon} 1${NUMBER_PAD}${blank}    ${title}  5′00″`)
	})
})
