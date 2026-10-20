import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3489: each running lane's CPU and memory at the end of its row, on no row where the pane is too narrow for it on any.

const { EMPTY_LAYOUT, GB, MINUTE, NOW, board_usage, header, lines_of } = run_board_render_fixture
const USAGE = /🔨 1 +20\.0 +1\.6 +0\.2 +Issue 1/u
const FIGURE = /\d\.\d/u
const WIDE = 200
const NARROW = 80
// Wide enough for a running row up to its usage, not for its tail and what it waits on after it too.
const FITTING = 100

const usages = board_usage(
	new Map([
		[1, { cpu_cores: 2, memory_bytes: 1.6 * GB, compressed_bytes: 0.2 * GB }],
		[2, { cpu_cores: 0.1, memory_bytes: GB, compressed_bytes: 0 }],
	]),
)

const running: BoardRow = {
	number: 1,
	title: 'Issue 1',
	kind: undefined,
	state: 'running',
	status: {
		state: 'running',
		started_ms: NOW,
		track: ['investigate', 'plan', 'implement'],
		phase_ms: NOW,
	},
	waits: ['3'],
}
const waiting: BoardRow = {
	number: 2,
	title: 'Issue 2',
	kind: undefined,
	state: 'waiting',
	status: undefined,
	waits: [],
}

function board(extra: Partial<BoardHeader> = {}): BoardHeader {
	return header({ layout: { ...EMPTY_LAYOUT, active: [running, waiting] }, usages, ...extra })
}

function row_line(lines: ReadonlyArray<string>, title: string): string {
	return lines.find((line) => line.includes(title)) ?? ''
}

function sized(columns: number): Array<string> {
	const size = { columns, rows: 50 }

	return run_board_render
		.render({ header: board(), notes: [], size })
		.map((line) => stripVTControlCharacters(line))
}

// The columns before `marker` on a line, as the terminal counts them.
function column_of(line: string, marker: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

// joshuafolkken/kit#4171: the cells after the row's number, before its title; none at the row's end.
describe('run_board_render.render usage cells', () => {
	it('draws a running row’s CPU, MEM and CMPRS before its title, and nothing at its end', () => {
		const lines = lines_of(board())

		expect(row_line(lines, 'Issue 1')).toMatch(USAGE)
		expect(row_line(lines, 'Issue 1')).toMatch(/ {2}🔨 0″ {2}🔗 3$/u)
		expect(row_line(lines, 'Issue 1')).not.toContain('🧠')
	})

	it('blanks the cells on a row that is not running, so every title starts in one column', () => {
		const lines = lines_of(board())

		expect(row_line(lines, 'Issue 2')).not.toMatch(FIGURE)
		expect(column_of(row_line(lines, 'Issue 2'), 'Issue 2')).toBe(
			column_of(row_line(lines, 'Issue 1'), 'Issue 1'),
		)
	})

	it('draws the cells in a chat as on a screen', () => {
		const lines = lines_of(board({ form: 'chat' }))

		expect(row_line(lines, 'Issue 1')).toMatch(USAGE)
	})

	it('keeps the cells before the title however narrow the pane', () => {
		expect(row_line(sized(WIDE), 'Issue 1')).toMatch(USAGE)
		expect(row_line(sized(NARROW), 'Issue 1')).toMatch(USAGE)
	})

	// joshuafolkken/kit#3769: only the tail and what a row waits on may wrap, never the columns before them.
	it('keeps the cells on every row where only the tail and what a row waits on would wrap', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running, waiting] }
		const lines = run_board_render.render({
			header: header({ layout, usages }),
			notes: [],
			size: { columns: FITTING, rows: 50 },
		})

		expect(stripVTControlCharacters(row_line(lines, 'Issue 1'))).toMatch(USAGE)
	})
})

// A running row's tail, after the head its cells are drawn in.
const TAIL = '  🔨 0″'

// joshuafolkken/kit#3769: a row with cells narrows its title, so its head stays on one line.
describe('run_board_render.render usage cells in a narrow pane', () => {
	it('narrows a running row’s title so its head, cells and all, stays on one line', () => {
		const line = row_line(sized(NARROW), 'Issue 1')
		const head = line.slice(0, line.indexOf(TAIL))

		expect(line).toMatch(USAGE)
		expect(run_board_fit.height_of(head, NARROW)).toBe(1)
	})
})

// joshuafolkken/kit#3554: the usage column on every row, a finished row's filled with its finish time,
// so every running row's tail starts in one column.
const TRACK: Array<Phase> = ['investigate', 'plan', 'ship']
const FINISH = /🔚 (?:\d+\/\d+ )?\d{2}:\d{2}/u
const PHASE_TIME = '30″'

function tracked(number: number, state: BoardRow['state'], ended_ms?: number): BoardRow {
	const status = {
		state,
		started_ms: NOW - MINUTE,
		ended_ms,
		track: TRACK,
		phase_ms: NOW - MINUTE / 2,
	}

	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

const mixed: ReadonlyArray<BoardRow> = [
	tracked(1, 'running'),
	tracked(3, 'merged', NOW - MINUTE),
	tracked(4, 'running'),
	tracked(5, 'done', NOW - MINUTE),
	tracked(6, 'running'),
	tracked(7, 'merged'),
	tracked(8, 'stopped', NOW - MINUTE),
]
const mixed_usages = board_usage(
	new Map([
		[1, { cpu_cores: 2, memory_bytes: 1.6 * GB, compressed_bytes: 0.2 * GB }],
		[4, { cpu_cores: undefined, memory_bytes: GB, compressed_bytes: 0 }],
	]),
)

function mixed_lines(extra: Partial<BoardHeader> = {}, columns = WIDE): Array<string> {
	const layout = { ...EMPTY_LAYOUT, active: mixed }
	const size = { columns, rows: 50 }

	return run_board_render
		.render({ header: header({ layout, usages: mixed_usages, ...extra }), notes: [], size })
		.map((line) => stripVTControlCharacters(line))
		.filter((line) => line.includes('Issue'))
}

describe('run_board_render.render usage column on every row', () => {
	it('starts every running row’s tail in one column whatever each row draws in the column', () => {
		const lines = mixed_lines()
		const columns = ['Issue 1', 'Issue 4', 'Issue 6'].map((title) =>
			column_of(row_line(lines, title), PHASE_TIME),
		)

		expect(columns[0]).toBeGreaterThan(0)
		expect(new Set(columns).size).toBe(1)
	})

	it('ends a settled row on its usage column, with no tail after it', () => {
		const lines = mixed_lines()

		expect(row_line(lines, 'Issue 3')).toMatch(/🔚 [\d/ :]+$/u)
		expect(row_line(lines, 'Issue 7')).not.toContain(PHASE_TIME)
	})

	it('draws a finished row’s finish time, and none on a row with no end or not finished', () => {
		const lines = mixed_lines()

		expect(row_line(lines, 'Issue 3')).toMatch(FINISH)
		expect(row_line(lines, 'Issue 5')).toMatch(FINISH)
		expect(row_line(lines, 'Issue 7')).not.toContain('🔚')
		expect(row_line(lines, 'Issue 8')).not.toContain('🔚')
	})

	it('draws no usage on a finished row', () => {
		const lines = mixed_lines()

		expect(row_line(lines, 'Issue 3')).toMatch(/^ {2}✅ 3 {4}Issue 3/u)
		expect(row_line(lines, 'Issue 5')).not.toMatch(FIGURE)
	})

	it('draws both in a chat as on a screen', () => {
		const lines = mixed_lines({ form: 'chat' })

		expect(lines).toStrictEqual(mixed_lines())
		expect(row_line(lines, 'Issue 3')).toMatch(FINISH)
	})
})

// Too narrow for a settled row with its finish time, wide enough for the row without it.
const FINISH_NARROW = 70

describe('run_board_render.render finish column on a narrow pane', () => {
	it('drops the finish time from every row where the column does not fit', () => {
		const lines = mixed_lines({}, FINISH_NARROW)

		expect(lines.join('\n')).not.toContain('🔚')
		expect(row_line(lines, 'Issue 3')).toMatch(/\d″$/u)
	})
})

// joshuafolkken/kit#4026: a plan row the run has not touched draws no blanks in the column, so what it
// waits on follows its title rather than starting where a running row's tail does.
function planned_lines(): Array<string> {
	const planned: BoardRow = {
		...waiting,
		number: 9,
		title: 'Planned',
		waits: ['3553', '3554'],
		reason: { icon: '🔗', issues: ['3553', '3554'] },
	}
	const queued = [{ kind: 'row' as const, row: planned }]
	const layout = { ...EMPTY_LAYOUT, active: mixed, queued }
	const size = { columns: WIDE, rows: 50 }
	const lines = run_board_render.render({
		header: header({ layout, usages: mixed_usages }),
		notes: [],
		size,
	})

	return lines.map((line) => stripVTControlCharacters(line))
}

describe('run_board_render.render usage column on a plan row', () => {
	it('starts what an untouched row waits on two blanks after its title', () => {
		const lines = planned_lines()

		expect(row_line(lines, 'Planned')).toMatch(/Planned {2}3554$/u)
	})
})
