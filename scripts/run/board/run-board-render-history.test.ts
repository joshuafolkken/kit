import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemState } from './run-board-status'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3526: a running row's track as a stage history — led by its newest icon, drawn after
// the lane's CPU and memory so those stay in one column whatever the track's length.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const { minute_of } = run_board_labels
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
			`  🚦 2    ${title}  05:00  ⚡  8% 🧠0.5G  🔍📝🔨🚢💥🔨🚢👀🚦`,
		)
	})
})

// Row 1 settled as `state` after `track`, on a board that still holds a usage reading for its lane.
function settled_line(state: ItemState, track: ReadonlyArray<Phase>): string {
	const status = { state, started_ms: NOW - 5 * MINUTE, ended_ms: NOW, track }
	const row: BoardRow = { number: 1, title: 'Sample 1', kind: undefined, state, status, waits: [] }

	return row_line(lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [row] }, usages })), 1)
}

// joshuafolkken/kit#3535: a settled row keeps its track, ended on its own state icon rather than a fixed
// ✅ — it runs no process, so it draws no CPU or memory; a finished one draws its finish time in their
// place (joshuafolkken/kit#3554).
describe('run_board_render.render settled history', () => {
	const title = 'Sample 1'.padEnd(48)

	it.each<[ItemState, string]>([
		['merged', '✅'],
		['done', '🏁'],
	])('draws a %s row’s finish time, then its track ended on its state icon', (state, icon) => {
		const finish = `🔚 ${minute_of(NOW)}`

		expect(settled_line(state, FAILED)).toBe(
			`  ${icon} 1    ${title}  05:00  ${finish}  🔍📝🔨🚢💥${icon}`,
		)
	})

	it.each<[ItemState, string]>([
		['stopped', '🛑'],
		['parked', '💤'],
	])('draws a %s row’s track ended on its state icon right after its time', (state, icon) => {
		expect(settled_line(state, FAILED)).toBe(`  ${icon} 1    ${title}  05:00  🔍📝🔨🚢💥${icon}`)
	})
})
