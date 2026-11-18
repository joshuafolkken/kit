import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_row, type RowFrame } from './run-board-render-row'
import { run_board_render_section } from './run-board-render-section'
import { run_board_render_time } from './run-board-render-time'
import { run_board_render_title } from './run-board-render-title'

// joshuafolkken/kit#8002: one row's drawing moved out of `run-board-render.ts`; `row_line` draws the same
// line the whole board draws for that row.

const { EMPTY_LAYOUT, header } = run_board_render_fixture
const { ROW_INDENT } = run_board_render_section

const DONE: BoardRow = {
	number: 8101,
	title: 'A finished row keeps its title',
	kind: undefined,
	state: 'done',
	status: undefined,
	waits: [],
}
const QUEUED: BoardRow = { ...DONE, number: 8102, title: 'A queued row waits', state: 'waiting' }
const LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [DONE],
	queued: [{ kind: 'row', row: QUEUED }],
}

function frame_of(board: BoardHeader): RowFrame {
	return {
		header: board,
		time_width: run_board_render_time.time_width(board),
		...run_board_render_title.WHOLE,
		columns: undefined,
		filed: new Set(),
		condition_width: run_board_render_condition.width_for(LAYOUT.unreached),
	}
}

function drawn(row: BoardRow, board: BoardHeader): string {
	return stripVTControlCharacters(
		run_board_render_row.row_line(ROW_INDENT, row, frame_of(board)).text,
	)
}

describe('run_board_render_row.row_line', () => {
	const board = header({ layout: LAYOUT })
	const lines = run_board_render
		.render({ header: board, notes: [] })
		.map((line) => stripVTControlCharacters(line))

	it('draws a done row as the board draws it', () => {
		const text = drawn(DONE, board)

		expect(text).toContain(String(DONE.number))
		expect(lines).toContain(text)
	})

	it('draws a queued row as the board draws it', () => {
		const text = drawn(QUEUED, board)

		expect(text).toContain(String(QUEUED.number))
		expect(lines).toContain(text)
	})
})
