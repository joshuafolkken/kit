import { stripVTControlCharacters } from 'node:util'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#8247: every rule keeps one width for a terminal width — with no lane row, any number
// of them, short titles or long — and never runs past the pane, themed or not.

const { EMPTY_LAYOUT, NOW, board_usage, header, note } = run_board_render_fixture
const { width_of } = run_board_fit
const TALL = 200
const COLUMNS = 160
// Narrower than a lane row's full title, wide enough for every rule's own label and column heads.
const NARROW = 60
const FIRST_LANE = 8240
const LANE_COUNT = 4
const SHORT_TITLE = 'Short'
const LONG_TITLE = 'A lane title far longer than the title column the board cuts every title to'
const RULE_MARKS = ['── ', '▾ ', '▸ ']

function lane(number: number, title: string): BoardRow {
	return {
		number,
		title,
		kind: undefined,
		state: 'running',
		status: { state: 'running', started_ms: NOW, phase_ms: NOW, track: ['implement'] },
		waits: [],
	}
}

function lanes(count: number, title = SHORT_TITLE): Array<BoardRow> {
	return Array.from({ length: count }, (_, index) => lane(FIRST_LANE + index, title))
}

function rule_widths(
	active: Array<BoardRow>,
	is_themed: boolean,
	columns = COLUMNS,
): Array<number> {
	const board = header({
		layout: { ...EMPTY_LAYOUT, active, unreached: [lane(FIRST_LANE - 1, SHORT_TITLE)] },
		occupied_count: active.length,
		lane_limit: LANE_COUNT,
		usages: board_usage(new Map()),
		is_themed,
	})
	const lines = run_board_render.render({
		header: board,
		notes: [note(NOW, 'seen')],
		size: { rows: TALL, columns },
		folded: new Set(),
	})

	return lines
		.map((line) => stripVTControlCharacters(line))
		.filter((line) => RULE_MARKS.some((mark) => line.startsWith(mark)))
		.map((line) => width_of(line))
}

describe.each([false, true])('run_board_render rule width (themed: %s)', (is_themed) => {
	it('draws every rule at one width with no lane row and with four', () => {
		const none = rule_widths([], is_themed)
		const four = rule_widths(lanes(LANE_COUNT), is_themed)

		expect(none.length).toBeGreaterThan(1)
		expect(new Set(none)).toStrictEqual(new Set([Math.max(...four)]))
		expect(new Set(four)).toStrictEqual(new Set(none))
	})

	it('draws the rules at one width for short titles and titles past the title column', () => {
		const short = rule_widths(lanes(1, SHORT_TITLE), is_themed)
		const long = rule_widths(lanes(1, LONG_TITLE), is_themed)

		expect(new Set(short)).toStrictEqual(new Set(long))
		expect(new Set(short).size).toBe(1)
	})

	it('ends every rule at the pane edge where the pane is narrower than a full title', () => {
		const widths = [
			...rule_widths([], is_themed, NARROW),
			...rule_widths(lanes(1), is_themed, NARROW),
		]

		expect(new Set(widths)).toStrictEqual(new Set([NARROW]))
	})
})
