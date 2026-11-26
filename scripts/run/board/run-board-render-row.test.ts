import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_faint } from './run-board-faint'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import { run_board_label_pair } from './run-board-label-pair'
import { run_board_labels } from './run-board-labels'
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
		stops_width: run_board_render_time.stops_width(board),
		...run_board_render_title.WHOLE,
		columns: undefined,
		filed: new Set(),
		condition_width: run_board_render_condition.width_for(LAYOUT.unreached),
	}
}

function drawn(row: BoardRow, board: BoardHeader, section?: RowFrame['section']): string {
	const frame = { ...frame_of(board), section }
	const { text } = run_board_render_row.row_line(ROW_INDENT, row, frame)

	// joshuafolkken/kit#8224: a board in no theme draws a row without its title mark.
	return run_board_label_pair.untitled(stripVTControlCharacters(text))
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

	// joshuafolkken/kit#8257: a queued row's path starts after the whole title column, as a waiting
	// row's reason and a done row's time do; a row with nothing after its title ends on it.
	it('pads a queued row’s title to the title column only where a path follows it', () => {
		const reason = { icon: '📂', issues: [String(DONE.number)], tail: 'package.json' }
		const held = drawn({ ...QUEUED, reason }, board, 'queued')
		const title_start = held.indexOf(QUEUED.title ?? '')

		expect(held.indexOf(reason.tail) - title_start).toBe(run_board_render.TITLE_LIMIT + 2)
		expect(drawn(QUEUED, board, 'queued').endsWith(QUEUED.title ?? '')).toBe(true)
	})

	it('draws a queued row as the board draws it', () => {
		const text = drawn(QUEUED, board)

		expect(text).toContain(String(QUEUED.number))
		expect(lines).toContain(text)
	})
})

// joshuafolkken/kit#8960: a row's area is drawn faint before its title, which gives up its columns.
describe('run_board_render_row.row_line -- area tag', () => {
	const board = header({ layout: LAYOUT })
	const tagged: BoardRow = { ...DONE, area: 'board' }
	const long = 'An area row whose long title runs past the title column and is cut at its end'

	it('draws the area and a blank between the kind and the title', () => {
		expect(drawn(tagged, board)).toContain(`  board ${DONE.title ?? ''}`)
	})

	it('draws the area faint where the stream has color', () => {
		const { text } = run_board_render_row.row_line(ROW_INDENT, tagged, frame_of(board))

		expect(text).toContain(`${run_board_faint.faint('board')} `)
	})

	it('leaves a row with no area as it was drawn before', () => {
		expect(drawn(DONE, board)).toContain(` ${DONE.title ?? ''}`)
		expect(drawn(DONE, board)).not.toContain('board')
	})

	it('cuts a long title by the tag’s columns, so the row keeps its width', () => {
		const frame = { ...frame_of(board), title_limit: 30 }
		const plain = { ...DONE, title: long }
		const area = { ...plain, area: 'theme' }

		expect(run_board_render_row.title_width(area, frame)).toBe(
			run_board_render_row.title_width(plain, frame),
		)
		expect(drawn(area, board)).toContain('theme An area row')
	})

	it('cuts the title to its mark where the area and ✚ fill a narrowed title column', () => {
		const lead = `board ${run_board_labels.FILED_RUN_MARK} `
		const frame = { ...frame_of(board), title_limit: lead.length, filed: new Set([DONE.number]) }
		const row = { ...tagged, title: long }

		expect(run_board_render_row.title_width(row, frame)).toBe(lead.length + 1)
	})
})

// joshuafolkken/kit#7992: the net times end in one column whether or not the host's stops follow them.
const { MINUTE, STARTED } = run_board_render_fixture
const SECOND = MINUTE / 60
// A done row keeps its title column (joshuafolkken/kit#4922), so the pane holds its head and brackets.
const PANE = 100
const LONG_TITLE = 'A finished row whose title runs past the title column and is cut'

function done_in(number: number, net_s: number, stops_s: number): BoardRow {
	const elapsed_ms = net_s * SECOND
	const excluded_ms = stops_s * SECOND
	const ended_ms = STARTED + elapsed_ms + excluded_ms
	const status = {
		state: 'merged' as const,
		started_ms: STARTED,
		ended_ms,
		elapsed_ms,
		excluded_ms,
	}

	return { ...DONE, number, title: `${LONG_TITLE} ${String(number)}`, status }
}

const TIMED = [
	{ row: done_in(8201, 5040, 231), time: '1°24′00″ (+3′51″)' },
	{ row: done_in(8202, 2660, 723), time: '44′20″ (+12′03″)' },
	{ row: done_in(8203, 486, 0), time: '8′06″' },
	{ row: done_in(8204, 5892, 0), time: '1°38′12″' },
]

function head_width(row: BoardRow, frame: RowFrame): number {
	return run_board_fit.width_of(
		stripVTControlCharacters(run_board_render_row.head_text(row, frame)),
	)
}

describe('run_board_render_row.row_line -- net times in one column', () => {
	const board = header({ layout: { ...EMPTY_LAYOUT, active: TIMED.map(({ row }) => row) } })
	const texts = TIMED.map(({ row }) => drawn(row, board))

	it('ends every net time in one column, the stops bracketed one blank after it', () => {
		const ends = TIMED.map(({ time }, index) => {
			const net = time.split(' ', 1)[0] ?? ''

			return (texts[index] ?? '').indexOf(time) + net.length
		})

		expect(new Set(ends).size).toBe(1)
	})

	it('ends a row with no stops at its net time', () => {
		expect(texts[2]?.endsWith(' 8′06″')).toBe(true)
		expect(texts[3]?.endsWith(' 1°38′12″')).toBe(true)
	})

	it('starts what follows the time in one column, stops or none', () => {
		const frame = frame_of(board)
		const heads = TIMED.map(({ row }) => head_width(row, frame))

		expect(new Set(heads).size).toBe(1)
	})

	it('keeps every row within a pane its title is cut to', () => {
		const lines = run_board_render
			.render({ header: board, notes: [], size: { columns: PANE, rows: PANE } })
			.map((line) => stripVTControlCharacters(line))
		const rows = lines.filter((line) => TIMED.some(({ time }) => line.includes(time)))

		expect(rows).toHaveLength(TIMED.length)
		expect(rows.every((line) => line.includes('…'))).toBe(true)
		expect(Math.max(...rows.map((line) => run_board_fit.width_of(line)))).toBeLessThanOrEqual(PANE)
	})
})
