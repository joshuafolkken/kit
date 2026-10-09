import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3526: a running row's track as a stage history — led by its newest icon, drawn after
// the lane's CPU and memory so those stay in one column whatever the track's length.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const GB = 1024 * 1024 * 1024
const CPU = '⚡'

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
const SHIPPED: ReadonlyArray<Phase> = [
	'investigate',
	'plan',
	'implement',
	'ship',
	'review',
	'gate',
	'sync',
	'commit',
	'round_two',
	'followup',
	'report',
]

function running(number: number, track: ReadonlyArray<Phase>): BoardRow {
	const status = { state: 'running' as const, started_ms: NOW - 5 * MINUTE, track }

	return { number, title: `Sample ${String(number)}`, state: 'running', status, waits: [] }
}

const ROWS = [running(1, PLANNED), running(2, RETRIED), running(3, FAILED), running(4, SHIPPED)]

const usages: LaneUsages = new Map(
	ROWS.map((row) => [row.number, { cpu_percent: 8, memory_bytes: GB / 2, memory_percent: 3 }]),
)

function board_lines(): Array<string> {
	return lines_of(header({ layout: { ...EMPTY_LAYOUT, active: ROWS }, usages }))
}

function row_line(lines: ReadonlyArray<string>, number: number): string {
	return lines.find((line) => line.includes(`Sample ${String(number)}`)) ?? ''
}

describe('run_board_render.render stage history', () => {
	it('leads every running row with the last icon of its track', () => {
		const lines = board_lines()

		expect(row_line(lines, 1)).toMatch(/^ {2}📝 1 .*🔍📝$/u)
		expect(row_line(lines, 2)).toMatch(/^ {2}🚦 2 .*🔍📝🔨🚢💥🔨🚢👀🚦$/u)
		expect(row_line(lines, 3)).toMatch(/^ {2}💥 3 .*🔍📝🔨🚢💥$/u)
		expect(row_line(lines, 4)).toMatch(/^ {2}📣 4 .*🔍📝🔨🚢👀🚦🔀📦🔂⚓📣$/u)
	})

	it('draws no dim line ahead of any track', () => {
		const rows = ROWS.map((row) => row_line(board_lines(), row.number))

		expect(rows.every((line) => !line.includes('─'))).toBe(true)
	})

	it('keeps the CPU and memory in one column whatever each track’s length', () => {
		const lines = board_lines()
		const columns = ROWS.map((row) => row_line(lines, row.number).indexOf(CPU))

		expect(columns[0]).toBeGreaterThan(0)
		expect(new Set(columns).size).toBe(1)
	})

	it('draws a row as the reference does: lead, number, title, time, usage, track', () => {
		const title = 'Sample 2'.padEnd(48)

		expect(row_line(board_lines(), 2)).toBe(
			`  🚦 2  ${title}  05:00  ⚡  8% 🧠0.5G  🔍📝🔨🚢💥🔨🚢👀🚦`,
		)
	})
})
