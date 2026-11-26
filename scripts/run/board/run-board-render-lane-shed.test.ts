import { stripVTControlCharacters } from 'node:util'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#8990: a lane row never wraps. Its title is cut down to nothing before its tail gives
// up a cell; past that the tail gives up its drift, its finish, CodeRabbit's mark, then the checks'
// counts, and `PR <n>` stays.

const { EMPTY_LAYOUT, MINUTE, NOW, header } = run_board_render_fixture
const { width_of } = run_board_fit
const TALL = 200
const LANE = 1042
const TITLE = 'Verify josh start end-to-end on a fresh machine with nothing installed'
// Median 40′: the 42′ lane runs `+120′` on its finish.
const TOTALS = [10, 20, 30, 40, 45, 160, 2000].map((minutes) => minutes * MINUTE)
const CHECKS: PrChecks = { pr: 3765, pass: 6, pending: 2, fail: 1, coderabbit: 'running' }
const REPORTED = 126
const NARROWEST = 30
const WIDEST = 200
// What the drift, the finish, CodeRabbit's mark and the counts draw, in the order they are given up.
const SHED_MARKS = ['+120′', '🎯', '🐰', '✓ 6']

const ROW: BoardRow = {
	number: LANE,
	title: TITLE,
	kind: undefined,
	state: 'running',
	status: {
		state: 'running',
		started_ms: NOW - 42 * MINUTE,
		track: ['followup'],
		phase_ms: NOW - 8 * MINUTE,
	},
	waits: [],
}

function lane_line(columns: number): string {
	const activity = { last_event_ms: NOW, is_stopped: false, pr_checks: new Map([[LANE, CHECKS]]) }
	const board = header({
		layout: { ...EMPTY_LAYOUT, active: [ROW] },
		lane_totals: TOTALS,
		activity,
	})
	const lines = run_board_render
		.render({ header: board, notes: [], size: { rows: TALL, columns }, folded: new Set() })
		.map((line) => stripVTControlCharacters(line))

	return lines.find((line) => line.includes(String(LANE))) ?? ''
}

// What the row draws after its number and the blank priority and kind columns.
function after_lead(line: string): string {
	return line.slice(line.indexOf(String(LANE)) + String(LANE).length).trimStart()
}

function widths(): Array<number> {
	return Array.from({ length: WIDEST - NARROWEST + 1 }, (_, index) => NARROWEST + index)
}

// The widest pane that leaves `mark` out of the lane row.
function widest_without(mark: string): number {
	return Math.max(...widths().filter((columns) => !lane_line(columns).includes(mark)))
}

describe('run_board_render.render — a lane row in a narrow pane', () => {
	it('fits the reported 126-column pane with one blank inside CodeRabbit’s mark', () => {
		const line = lane_line(REPORTED)

		expect(width_of(line)).toBeLessThanOrEqual(REPORTED)
		expect(line).toContain('PR 3765')
		expect(line).not.toContain('🐰  ⏳')
	})

	it('never runs a lane row past the pane', () => {
		const overrun = widths().filter((columns) => width_of(lane_line(columns)) > columns)

		expect(overrun).toStrictEqual([])
	})

	// The blanks after the number are the priority and kind columns every row lines up on.
	it('draws no run of blanks after the lead where the title is cut to nothing', () => {
		const padded = widths().filter((columns) => / {3}/u.test(after_lead(lane_line(columns))))

		expect(padded).toStrictEqual([])
	})

	it('gives up the drift first, then the finish, CodeRabbit’s mark and the counts', () => {
		const order = SHED_MARKS.map((mark) => widest_without(mark))

		expect(order).toStrictEqual(order.toSorted((left, right) => right - left))
		expect(new Set(order).size).toBe(SHED_MARKS.length)
	})
})
