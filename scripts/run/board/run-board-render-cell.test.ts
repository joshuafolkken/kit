import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_cell } from './run-board-render-cell'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4217: a row's finish-time column — blanks on an untouched plan row, nothing on a
// parked or tailed row — split out of `run-board-render.ts` to keep it within its line limit.

const { cell_text } = run_board_render_cell
const { MINUTE, NOW, header } = run_board_render_fixture
const WIDTH = 9

function row(state: BoardRow['state'], status?: BoardRow['status']): BoardRow {
	return { number: 1, title: 'Issue 1', kind: undefined, state, status, waits: [] }
}

function merged(): BoardRow {
	return row('merged', { state: 'merged', started_ms: NOW - MINUTE, ended_ms: NOW, track: [] })
}

describe('run_board_render_cell.cell_text', () => {
	it('draws a finished row’s finish time', () => {
		expect(cell_text(merged(), WIDTH, header())).toContain('🔚')
	})

	it('draws nothing where the frame has no finish-time column', () => {
		expect(cell_text(merged(), 0, header())).toBeUndefined()
	})

	it('draws blanks on a plan row the run has not touched', () => {
		expect(cell_text(row('stopped'), WIDTH, header())).toBe(' '.repeat(WIDTH))
	})

	it('draws nothing on a parked row', () => {
		const parked = row('stopped', { state: 'parked', started_ms: NOW - MINUTE, track: [] })

		expect(cell_text(parked, WIDTH, header())).toBeUndefined()
	})
})
