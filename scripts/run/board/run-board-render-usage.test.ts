import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import type { Phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3489: each running lane's CPU and memory at the end of its row — never in a chat,
// and on no row where the pane is too narrow for it on any.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const GB = 1024 * 1024 * 1024
const USAGE = '⚡ 20% 🧠1.6G'
const WIDE = 200
const NARROW = 80
// Wide enough for a running row up to its usage, not for its three-round track after it too.
const FITTING = 100

const usages: LaneUsages = new Map([
	[1, { cpu_percent: 20, memory_bytes: 1.6 * GB, memory_percent: 9 }],
	[2, { cpu_percent: 1, memory_bytes: GB, memory_percent: 5 }],
])

const running: BoardRow = {
	number: 1,
	title: 'Issue 1',
	kind: undefined,
	state: 'running',
	status: { state: 'running', started_ms: NOW, track: ['investigate', 'plan', 'implement'] },
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

describe('run_board_render.render usage column', () => {
	// joshuafolkken/kit#3526: the usage before the track, which grows with every round.
	it('draws a running row’s usage before its track, and both before what it waits on', () => {
		const lines = lines_of(board())

		expect(row_line(lines, 'Issue 1')).toMatch(/ {2}⚡ 20% 🧠1\.6G {2}🔍📝🔨 {2}🔗 3$/u)
		expect(row_line(lines, 'Issue 2')).not.toContain('⚡')
	})

	it('draws no usage in a chat', () => {
		expect(lines_of(board({ form: 'chat' })).join('\n')).not.toContain(USAGE)
	})

	it('drops the column from every row where a running row would wrap with it', () => {
		expect(row_line(sized(WIDE), 'Issue 1')).toContain(USAGE)
		expect(row_line(sized(NARROW), 'Issue 1')).not.toContain('⚡')
		expect(row_line(sized(NARROW), 'Issue 1')).toContain('Issue 1')
	})

	// joshuafolkken/kit#3526: the track grows without bound, so its length never takes the column away.
	it('keeps the column on every row however long a running row’s track has grown', () => {
		const round: Array<Phase> = ['implement', 'ship', 'failed']
		const track: Array<Phase> = ['investigate', 'plan', ...round, ...round, ...round]
		const long: BoardRow = { ...running, status: { state: 'running', started_ms: NOW, track } }
		const layout = { ...EMPTY_LAYOUT, active: [long, waiting] }
		const lines = run_board_render.render({
			header: header({ layout, usages }),
			notes: [],
			size: { columns: FITTING, rows: 50 },
		})

		expect(stripVTControlCharacters(row_line(lines, 'Issue 1'))).toContain(USAGE)
	})
})

// joshuafolkken/kit#3554: the usage column on every row, a finished row's filled with its finish time,
// so every track starts in one column.
const TRACK: Array<Phase> = ['investigate', 'plan', 'ship']
const FINISH = /🔚 (?:\d+\/\d+ )?\d{2}:\d{2}/u

function tracked(number: number, state: BoardRow['state'], ended_ms?: number): BoardRow {
	const status = { state, started_ms: NOW - MINUTE, ended_ms, track: TRACK }

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
const mixed_usages: LaneUsages = new Map([
	[1, { cpu_percent: 20, memory_bytes: 1.6 * GB, memory_percent: 9 }],
	[4, { cpu_percent: undefined, memory_bytes: GB, memory_percent: 5 }],
])

function mixed_lines(extra: Partial<BoardHeader> = {}, columns = WIDE): Array<string> {
	const layout = { ...EMPTY_LAYOUT, active: mixed }
	const size = { columns, rows: 50 }

	return run_board_render
		.render({ header: header({ layout, usages: mixed_usages, ...extra }), notes: [], size })
		.map((line) => stripVTControlCharacters(line))
		.filter((line) => line.includes('Issue'))
}

// The columns before a row's track, as the terminal counts them.
function track_column(line: string): number {
	return run_board_fit.width_of(line.slice(0, line.indexOf('🔍')))
}

describe('run_board_render.render usage column on every row', () => {
	it('starts every row’s track in one column whatever each row draws in the column', () => {
		const columns = mixed_lines().map((line) => track_column(line))

		expect(new Set(columns).size).toBe(1)
	})

	it('draws a finished row’s finish time, and none on a row with no end or not finished', () => {
		const lines = mixed_lines()

		expect(row_line(lines, 'Issue 3')).toMatch(FINISH)
		expect(row_line(lines, 'Issue 5')).toMatch(FINISH)
		expect(row_line(lines, 'Issue 7')).not.toContain('🔚')
		expect(row_line(lines, 'Issue 8')).not.toContain('🔚')
	})

	it('drops the finish time with the usage where the column does not fit', () => {
		const lines = mixed_lines({}, NARROW)

		expect(lines.join('\n')).not.toMatch(/[🔚⚡]/u)
		expect(row_line(lines, 'Issue 3')).toMatch(/\d{2}:\d{2} {2}🔍/u)
	})

	it('draws neither in a chat, whose rows stay as they were', () => {
		const lines = mixed_lines({ form: 'chat' })

		expect(lines.join('\n')).not.toMatch(/[🔚⚡]/u)
		expect(row_line(lines, 'Issue 7')).toMatch(/Issue 7 {2}🔍/u)
	})
})

// A plan row the run has not touched draws no column, so what it waits on stays beside its title.
function planned_line(): string {
	const planned: BoardRow = { ...waiting, number: 9, title: 'Planned', waits: ['3554'] }
	const waves = [[{ kind: 'row' as const, row: planned }]]
	const layout = { ...EMPTY_LAYOUT, active: mixed, waves }
	const size = { columns: WIDE, rows: 50 }
	const lines = run_board_render.render({
		header: header({ layout, usages: mixed_usages }),
		notes: [],
		size,
	})

	return row_line(
		lines.map((line) => stripVTControlCharacters(line)),
		'Planned',
	)
}

describe('run_board_render.render usage column on a plan row', () => {
	it('keeps what an untouched row waits on right after its title', () => {
		expect(planned_line()).toMatch(/Planned {2}\S+ \S*3554$/u)
	})
})
