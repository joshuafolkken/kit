import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_label_pair } from './run-board-label-pair'
import type { BoardRow, RowReason } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#8257: every section's row starts at one shared column, and a queued row's path
// starts where a waiting row's reason and a done row's time do.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, board_usage, header, lines_of } =
	run_board_render_fixture
const { ROW_INDENT, width_of } = run_board_fit
const LANE = 8301
const QUEUED = 8302
const WAITING = 8303
const DONE = 8304
const BARE = 8305
const PATH = 'package.json'
const REASON = 'superseded'
const SHORT_TITLE = 'Short title'
const GAP = '  '
const HELD: RowReason = { icon: '📂', issues: [String(LANE)], tail: PATH }
const NARROW = { occupied: 1, limit: 2 }
// A lanes label wider than the lead before the rule's ⏰, which pushes the time columns right.
const WIDE = { occupied: 10, limit: 12 }

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: SHORT_TITLE,
		kind: undefined,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

function lane(): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - MINUTE,
		track: ['implement' as const],
		phase_ms: NOW - MINUTE,
	}

	return row(LANE, { state: 'running', status })
}

function done(): BoardRow {
	const status = { state: 'merged' as const, started_ms: STARTED, ended_ms: NOW - MINUTE }

	return row(DONE, { state: 'merged', status })
}

// A board of a running lane with a free seat, a queued row held on a path, one with nothing after
// its title, a waiting row with a reason and a done row; `lanes` widens the lanes rule's count.
function board(lanes: Readonly<{ occupied: number; limit: number }> = NARROW): Array<string> {
	const queued = [row(QUEUED, { reason: HELD }), row(BARE)].map((entry) => ({
		kind: 'row' as const,
		row: entry,
	}))
	const waiting = row(WAITING, {
		title: 'x'.repeat(run_board_render.TITLE_LIMIT),
		reason: { tail: REASON },
	})
	const layout = { ...EMPTY_LAYOUT, active: [lane(), done()], queued, unreached: [waiting] }
	const usages = board_usage(new Map())
	const seats = { refusal: 'no room', hold: undefined }
	const counts = { occupied_count: lanes.occupied, lane_limit: lanes.limit }
	const view = header({ layout, usages, spinner: '⠋', ...counts, seats })

	return lines_of(view).map((line) => run_board_label_pair.untitled(line))
}

function line_of(lines: ReadonlyArray<string>, text: string): string {
	return lines.find((line) => line.includes(text)) ?? ''
}

// The terminal column `text` starts at on the line that holds `on`.
function column_of(lines: ReadonlyArray<string>, on: string, text: string): number {
	const line = line_of(lines, on)

	return width_of(line.slice(0, line.indexOf(text)))
}

describe('run_board_render.render — the shared row indent', () => {
	const lines = board()

	it('stands a lane row’s phase icon and a free seat’s 💺 in the row indent’s column', () => {
		expect(column_of(lines, ` ${String(LANE)} `, '🔨')).toBe(ROW_INDENT.length)
		expect(column_of(lines, '💺', '💺')).toBe(ROW_INDENT.length)
	})

	it.each([QUEUED, WAITING, DONE])('starts row %i’s icon in the row indent’s column', (number) => {
		const line = line_of(lines, ` ${String(number)} `)

		expect(line.startsWith(ROW_INDENT)).toBe(true)
		expect(line.at(ROW_INDENT.length)).not.toBe(' ')
	})

	it('draws the lanes rule’s 💪 CPU over the column the lane row’s cells start at', () => {
		const rule = line_of(lines, '💪 CPU')
		const lane_line = line_of(lines, ` ${String(LANE)} `)
		const lead = lane_line.slice(0, lane_line.lastIndexOf('″') + 1)
		const label = rule.slice(0, rule.indexOf('💪 CPU'))

		expect(width_of(label)).toBe(width_of(`${lead} `))
	})
})

// A lanes label past the lead's room moves the time and usage columns right, never the icon.
describe('run_board_render.render — a wide lanes label', () => {
	const lines = board(WIDE)

	it('keeps a lane row’s phase icon and a free seat’s 💺 in the row indent’s column', () => {
		expect(column_of(lines, ` ${String(LANE)} `, '🔨')).toBe(ROW_INDENT.length)
		expect(column_of(lines, '💺', '💺')).toBe(ROW_INDENT.length)
	})

	it('still stands the rule’s 💪 CPU over the lane row’s cells', () => {
		const rule = line_of(lines, '💪 CPU')
		const lane_line = line_of(lines, ` ${String(LANE)} `)
		const lead = lane_line.slice(0, lane_line.lastIndexOf('″') + 1)
		const label = rule.slice(0, rule.indexOf('💪 CPU'))

		expect(width_of(label)).toBe(width_of(`${lead} `))
	})
})

describe('run_board_render.render — the queued row’s path column', () => {
	const lines = board()

	it('starts a short-titled queued row’s path where a waiting row’s reason starts', () => {
		expect(column_of(lines, ` ${String(QUEUED)} `, PATH)).toBe(
			column_of(lines, ` ${String(WAITING)} `, REASON),
		)
	})

	it('starts the path where a done row’s time cell starts, after the whole title column', () => {
		const title = column_of(lines, ` ${String(DONE)} `, SHORT_TITLE)

		expect(column_of(lines, ` ${String(QUEUED)} `, SHORT_TITLE)).toBe(title)
		expect(column_of(lines, ` ${String(QUEUED)} `, PATH)).toBe(
			title + run_board_render.TITLE_LIMIT + GAP.length,
		)
	})

	it('ends a queued row with nothing after its title on its title', () => {
		expect(line_of(lines, ` ${String(BARE)} `).endsWith(SHORT_TITLE)).toBe(true)
	})
})
