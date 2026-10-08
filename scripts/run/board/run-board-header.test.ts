import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'

// joshuafolkken/kit#3430: the board's top lines — which state wins, what the plan line says when a
// fetch has not happened or has failed, and how the progress counts are drawn from the layout.

const { clock_of } = run_board_labels
const WORDS = run_board_labels.words_of('en')
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 30 * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, state, status: undefined, waits: [] }
}

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		words: WORDS,
		started_ms: STARTED,
		activity: { last_event_ms: undefined, idle: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: undefined,
		plan_failed_ms: undefined,
		...extra,
	}
}

function title_of(board: BoardHeader): string {
	return run_board_header.header_lines(board)[0] ?? ''
}

describe('run_board_header.header_lines state', () => {
	it('draws an ended run as ended even with a child still marked running', () => {
		const layout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }
		const activity = { last_event_ms: undefined, idle: undefined, is_stopped: true }

		expect(title_of(header({ layout, activity }))).toContain(`backlogrun ${WORDS.stopped}`)
	})

	it('draws a running run as running and a plan left only to people as waiting on a person', () => {
		const running = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }
		const human = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		expect(title_of(header({ layout: running }))).toContain(`backlogrun ${WORDS.running}`)
		expect(title_of(header({ layout: human }))).toContain(`backlogrun ${WORDS.human}`)
	})

	it('leaves out the last event before the stream has one', () => {
		expect(title_of(header())).not.toContain(WORDS.last_event)
	})
})

describe('run_board_header.header_lines plan line', () => {
	it('says the plan is not fetched yet, and has no progress line without a layout', () => {
		const lines = run_board_header.header_lines(header({ layout: undefined }))

		expect(lines).toStrictEqual([
			title_of(header()),
			`${WORDS.updated} ${clock_of(NOW)} · ${WORDS.plan_none}`,
		])
	})

	it('keeps the last fetch and warns about the failed one after it', () => {
		const board = header({ plan_fetched_ms: NOW - MINUTE, plan_failed_ms: NOW })
		const [, plan] = run_board_header.header_lines(board)

		expect(plan).toContain(`${WORDS.plan} ${clock_of(NOW - MINUTE)} ${WORDS.plan_fetched}`)
		expect(plan).toContain(`⚠ ${WORDS.plan_failed} ${clock_of(NOW)}`)
	})
})

describe('run_board_header.counts_of', () => {
	it('counts the active rows by state and every planned row toward the total', () => {
		const active = [row(1, 'merged'), row(2, 'parked'), row(3, 'done'), row(4, 'running')]
		const epic = { kind: 'epic' as const, epic: 10, rows: [row(11, 'waiting'), row(12, 'waiting')] }
		const layout: BoardLayout = {
			active,
			waves: [[epic, { kind: 'row', row: row(5, 'waiting') }]],
			people: [row(6, 'human')],
			unreached: [row(7, 'waiting')],
		}

		expect(run_board_header.counts_of(layout)).toStrictEqual({
			total: 9,
			settled: 3,
			merged: 1,
			parked: 1,
			running: 1,
			remaining: 5,
		})
	})
})
