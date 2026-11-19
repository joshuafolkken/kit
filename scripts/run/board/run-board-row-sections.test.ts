import { describe, expect, it } from 'vitest'
import { run_board_header } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_row_sections } from './run-board-row-sections'

// joshuafolkken/kit#8003: the key of every row the layout puts in a keyed section, drawn or not.

const { EMPTY_LAYOUT, header } = run_board_render_fixture
const { done_rows, keys_of, known_of } = run_board_row_sections

function row_of(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: 'a title', kind: undefined, state, status: undefined, waits: [] }
}

const LAYOUT: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [row_of(1, 'running'), row_of(2, 'done'), row_of(3, 'human')],
	queued: [
		{ kind: 'row', row: row_of(4, 'waiting') },
		{ kind: 'epic', epic: 9, title: 'an epic', rows: [row_of(5, 'waiting')] },
	],
	people: [row_of(6, 'human')],
	unreached: [row_of(7, 'waiting')],
}

describe('run_board_row_sections', () => {
	it('keys every row by the section the frame draws it in, an epic’s children among the queued', () => {
		expect([...keys_of(LAYOUT)]).toStrictEqual([
			'lanes:1',
			'decision:3',
			'decision:6',
			'queued:4',
			'queued:5',
			'waiting:7',
			'done:2',
		])
	})

	it('keys none before a layout is read, and finds the finished rows done', () => {
		expect(keys_of(undefined).size).toBe(0)
		expect(done_rows(LAYOUT).map((row) => row.number)).toStrictEqual([2])
	})
})

// joshuafolkken/kit#8115: what a frame knows is every row's key, every queued epic's and the now line's.
describe('run_board_row_sections.known_of', () => {
	const board = header({ layout: LAYOUT })
	const known = known_of(board)

	it('knows every row key and the queued epic’s, whether its 📁 line is drawn or not', () => {
		expect(known).toStrictEqual(
			new Set([...keys_of(LAYOUT), 'epic:9', run_board_header.now_key(board)]),
		)
	})

	it('knows the now line’s key', () => {
		expect(run_board_header.now_key(board)).toBeDefined()
		expect(known.has(run_board_header.now_key(board) ?? '')).toBe(true)
	})

	it('knows no epic before a layout is read', () => {
		expect(
			[...known_of(header({ layout: undefined }))].some((key) => key.startsWith('epic:')),
		).toBe(false)
	})
})
