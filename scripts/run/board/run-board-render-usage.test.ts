import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { LaneUsages } from './run-board-usage'

// joshuafolkken/kit#3489: each running lane's CPU and memory at the end of its row — on running rows
// only, never in a chat, and on no row where the pane is too narrow for it on any.

const { EMPTY_LAYOUT, NOW, header, lines_of } = run_board_render_fixture
const GB = 1024 * 1024 * 1024
const USAGE = '⚡ 20% 🧠1.6G'
const WIDE = 200
const NARROW = 90

const usages: LaneUsages = new Map([
	[1, { cpu_percent: 20, memory_bytes: 1.6 * GB, memory_percent: 9 }],
	[2, { cpu_percent: 1, memory_bytes: GB, memory_percent: 5 }],
])

const running: BoardRow = {
	number: 1,
	title: 'Issue 1',
	state: 'running',
	status: { state: 'running', started_ms: NOW, phase: 'implement' },
	waits: ['3'],
}
const waiting: BoardRow = {
	number: 2,
	title: 'Issue 2',
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
	it('ends a running row with its lane’s usage, before what it waits on', () => {
		const lines = lines_of(board())

		expect(row_line(lines, 'Issue 1')).toMatch(/ {2}⚡ 20% 🧠1\.6G {2}🔗 3$/u)
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
})
