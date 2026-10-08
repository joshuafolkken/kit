import { stripVTControlCharacters, styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'

// joshuafolkken/kit#3430: the board's top lines — which state wins, what the plan line says when a
// fetch has failed, and how the progress counts are drawn from the layout. joshuafolkken/kit#3444: two
// lines of symbols, no `updated` line, and a heartbeat colored by how stale the stream is.

const { clock_of } = run_board_labels
const WORDS = run_board_labels.words_of('en')
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 30 * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, state, status: undefined, waits: [] }
}

const RUNNING_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		words: WORDS,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: undefined, idle: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: undefined,
		plan_failed_ms: undefined,
		...extra,
	}
}

function lines_of(board: BoardHeader): Array<string> {
	return run_board_header.header_lines(board).map((line) => stripVTControlCharacters(line))
}

function title_of(board: BoardHeader): string {
	return lines_of(board)[0] ?? ''
}

// The raw title, colors kept, of a running run whose newest event is `age_ms` old.
function aged_title(age_ms: number): string {
	const activity = { last_event_ms: NOW - age_ms, idle: undefined, is_stopped: false }

	return run_board_header.header_lines(header({ layout: RUNNING_LAYOUT, activity }))[0] ?? ''
}

describe('run_board_header.header_lines state', () => {
	it('draws an ended run as ended even with a child still marked running', () => {
		const activity = { last_event_ms: undefined, idle: undefined, is_stopped: true }

		expect(title_of(header({ layout: RUNNING_LAYOUT, activity }))).toMatch(/^■ backlogrun/u)
	})

	it('draws a running run as running and a plan left only to people as waiting on a person', () => {
		const human = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		expect(title_of(header({ layout: RUNNING_LAYOUT }))).toMatch(/^▶ backlogrun/u)
		expect(title_of(header({ layout: human }))).toMatch(/^✋ backlogrun/u)
		expect(title_of(header())).toMatch(/^⏸ backlogrun/u)
	})

	// joshuafolkken/kit#3439
	it('draws an ended run with how long it took and when it ended, and no time left', () => {
		const activity = { last_event_ms: undefined, idle: undefined, is_stopped: true }
		const ended_ms = STARTED + 90 * MINUTE
		const title = title_of(header({ activity, ended_ms }))

		expect(title).toBe(`■ backlogrun   ⏱ 90:00   ${WORDS.ended_at} ${clock_of(ended_ms)}`)
	})

	it('leaves out the heartbeat before the stream has one', () => {
		expect(title_of(header())).not.toContain('💓')
	})
})

describe('run_board_header.header_lines shape', () => {
	it('draws the elapsed, the time left and the heartbeat on the title line', () => {
		const activity = { last_event_ms: NOW - MINUTE, idle: undefined, is_stopped: false }

		expect(title_of(header({ activity }))).toBe('⏸ backlogrun   ⏱ 30:00   ⌛ 7h30m   💓 01:00')
	})

	it('draws the title and the progress bar only, with no updated line', () => {
		const layout = { ...RUNNING_LAYOUT, unreached: [row(2, 'waiting')] }

		expect(lines_of(header({ layout }))).toStrictEqual([
			'▶ backlogrun   ⏱ 30:00   ⌛ 7h30m',
			`${'░'.repeat(20)}  0/2   ✅ 0  💤 0  🔄 1  ⏳ 1`,
		])
	})

	it('has no progress line without a layout', () => {
		expect(lines_of(header({ layout: undefined }))).toStrictEqual([title_of(header())])
	})
})

describe('run_board_header.header_lines plan warning', () => {
	it('says nothing about a plan read that succeeded', () => {
		expect(title_of(header({ plan_fetched_ms: NOW }))).not.toContain('⚠')
	})

	it('warns with the minute of a failed plan read', () => {
		const board = header({ plan_fetched_ms: NOW - MINUTE, plan_failed_ms: NOW })

		expect(title_of(board)).toContain(`⚠ ${WORDS.plan} ${clock_of(NOW).slice(0, 5)}`)
	})
})

describe('run_board_header.header_lines heartbeat color', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('leaves a fresh heartbeat plain, then yellow past 15 minutes and red past 30', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(aged_title(MINUTE)).toContain(' 💓 01:00')
		expect(aged_title(20 * MINUTE)).toContain(styleText('yellow', '💓 20:00'))
		expect(aged_title(40 * MINUTE)).toContain(styleText('red', '💓 40:00'))
	})

	it('leaves a stale heartbeat plain while the run is not running', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const activity = { last_event_ms: NOW - 40 * MINUTE, idle: undefined, is_stopped: false }
		const title = run_board_header.header_lines(header({ activity }))[0] ?? ''

		expect(title).not.toContain(styleText('red', '💓 40:00'))
	})
})

describe('run_board_header.counts_of', () => {
	it('counts the active rows by state and every planned row toward the total', () => {
		const active = [row(1, 'merged'), row(2, 'parked'), row(3, 'done'), row(4, 'running')]
		const epic = {
			kind: 'epic' as const,
			epic: 10,
			title: undefined,
			rows: [row(11, 'waiting'), row(12, 'waiting')],
		}
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
