import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_render_title } from './run-board-render-title'

const { ELLIPSIS, TITLE_LIMIT, fitted, reason_text, title_of } = run_board_render_title

const SECOND = 1000
const NOW = 1_000_000
const STAGE_SECONDS = 42
const LONG_TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
const SHORT_TITLE = 'Short title'
const UNTRIAGED: RowReason = { text: 'untriaged' }
const INSTALLING: RowReason = { text: 'installing', since_ms: NOW - STAGE_SECONDS * SECOND }
const TITLE_FLOOR = 8
const OVERRUN = 8
const TINY_PANE = 10

function row_of(extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number: 1,
		title: LONG_TITLE,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

// A row's line as a renderer would draw it: its title at the limit, then its reason.
function draw_of(row: BoardRow): (title_limit: number) => string {
	return function draw(title_limit: number): string {
		return `${title_of(row.title, title_limit)} ${row.reason?.text ?? ''}`
	}
}

function fitted_in(row: BoardRow, columns: number | undefined): string {
	return fitted(row, columns, draw_of(row))
}

// The pane the row's full-title line runs `OVERRUN` columns past.
function pane_of(row: BoardRow): number {
	return run_board_fit.width_of(draw_of(row)(TITLE_LIMIT)) - OVERRUN
}

describe('run_board_render_title.title_of', () => {
	it('leaves a title within the limit whole', () => {
		expect(title_of(SHORT_TITLE)).toBe(SHORT_TITLE)
	})

	it('cuts a longer title to the limit, ending in an ellipsis', () => {
		const cut = title_of(LONG_TITLE)

		expect(cut).toHaveLength(TITLE_LIMIT)
		expect(cut.endsWith(ELLIPSIS)).toBe(true)
	})

	it('draws a missing title as nothing', () => {
		expect(title_of()).toBe('')
	})
})

describe('run_board_render_title.reason_text', () => {
	it('says nothing for a row with no reason', () => {
		expect(reason_text(row_of(), NOW)).toBeUndefined()
	})

	it('says a reason with no stage as it is', () => {
		expect(reason_text(row_of({ reason: UNTRIAGED }), NOW)).toBe('untriaged')
	})

	it('says a stage with how long the lane has stood at it', () => {
		expect(reason_text(row_of({ reason: INSTALLING }), NOW)).toBe('installing 0:42')
	})
})

describe('run_board_render_title.fitted', () => {
	it('gives up exactly the columns the line runs past the pane', () => {
		const row = row_of({ reason: UNTRIAGED })
		const columns = pane_of(row)

		expect(run_board_fit.width_of(fitted_in(row, columns))).toBe(columns)
	})

	it('never cuts the title under the floor', () => {
		const row = row_of({ reason: UNTRIAGED })

		expect(fitted_in(row, TINY_PANE)).toBe(draw_of(row)(TITLE_FLOOR))
	})

	it('leaves a row with no reason at the title column', () => {
		const row = row_of()

		expect(fitted_in(row, TINY_PANE)).toBe(draw_of(row)(TITLE_LIMIT))
	})

	it('leaves a line that is not kept within a pane at the title column', () => {
		const row = row_of({ reason: UNTRIAGED })

		expect(fitted_in(row, undefined)).toBe(draw_of(row)(TITLE_LIMIT))
	})
})
