import { stripVTControlCharacters, styleText } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { LaneEvent } from './run-board-lane-event'
import type { BoardRow } from './run-board-layout'
import type { SessionOperations } from './run-board-operation-read'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_tail } from './run-board-render-tail'
import type { UsualTimes } from './run-board-usual'

// joshuafolkken/kit#3769, #4043: a running row ends on its phase's icon and how long it has stood at
// it — colored against the phase's usual time — then ` · ` and the kind and the age of its newest
// activity, each time right-aligned in one column on every row; the event that entered the phase is
// not drawn twice.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const PHASE_TIME = '10′00″'
const PHASE_PART = `👀 ${PHASE_TIME}`
// The blanks an icon's two columns take.
const ICON_BLANK = '  '
const SECOND = MINUTE / 60
const SECONDS_40 = 40 * SECOND
const MINUTES_61_SECONDS_5 = 61 * MINUTE + 5 * SECOND
// A phase three digits of minutes long, as a run past 100 minutes reaches.
const LONG_PHASE = 125 * MINUTE
const EVENT: LaneEvent = { phase: 'review', words: 'ship review', at_ms: NOW - 3 * MINUTE }

function running(number: number, title = `Issue ${String(number)}`): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - number * MINUTE,
		track: ['implement' as const, 'review' as const],
		phase_ms: NOW - 10 * MINUTE,
	}

	return { number, title, kind: undefined, state: 'running', status, waits: [] }
}

// A row that reached its phase `ago_ms` before now.
function phased(row: BoardRow, ago_ms: number): BoardRow {
	return { ...row, status: { ...row.status, state: 'running', phase_ms: NOW - ago_ms } }
}

function board(extra: Partial<BoardHeader> = {}): BoardHeader {
	const activity = {
		last_event_ms: NOW - MINUTE,
		is_stopped: false,
		lane_events: new Map([[1, EVENT]]),
	}

	return header({ activity, ...extra })
}

function operations(issue: number, at_ms: number): SessionOperations {
	const operation = { kind: 'Bash', target: 'pnpm', at_ms }

	return { lanes: [{ issue, operation }], owner: undefined, judgment: undefined }
}

function usual(minutes: number): UsualTimes {
	return new Map([['review', minutes * MINUTE]])
}

function tail(row: BoardRow, extra: Partial<BoardHeader> = {}): Array<string | undefined> {
	return run_board_render_tail.tail_of(row, board(extra))
}

// A running row's whole end outside followup: one part.
function quiet_tail(row: BoardRow, extra: Partial<BoardHeader> = {}): string | undefined {
	return tail(row, extra)[0]
}

// The phase part of row 2 — which has no event of its own, so it draws no activity — reached
// `ago_ms` before now.
function phase_time(ago_ms: number, extra: Partial<BoardHeader> = {}): string | undefined {
	return quiet_tail(phased(running(2), ago_ms), extra)
}

// Row 2's newest activity is the operation `minutes` old.
function operated_activity(minutes: number): string | undefined {
	return quiet_tail(running(2), { operations: operations(2, NOW - minutes * MINUTE) })
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_tail.tail_of phase time', () => {
	it('draws the phase’s icon and how long the child has stood at it, plain without a usual time', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(quiet_tail(running(2))).toBe(PHASE_PART)
	})

	it('draws the time plain up to twice the usual time, yellow past it and red past three times', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(quiet_tail(running(2), { usual: usual(5) })).toBe(PHASE_PART)
		expect(quiet_tail(running(2), { usual: usual(4) })).toBe(
			`👀 ${styleText('yellow', PHASE_TIME)}`,
		)
		expect(quiet_tail(running(2), { usual: usual(3) })).toBe(`👀 ${styleText('red', PHASE_TIME)}`)
	})

	it('counts a near-zero usual time as two minutes, so a stage of seconds is not drawn as alarming', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const floor = { usual: usual(0) }

		expect(phase_time(3 * MINUTE, floor)).toBe('👀 3′00″')
		expect(phase_time(5 * MINUTE, floor)).toBe(`👀 ${styleText('yellow', '5′00″')}`)
		expect(phase_time(7 * MINUTE, floor)).toBe(`👀 ${styleText('red', '7′00″')}`)
	})

	it('draws blanks where no event said when the child got to its phase', () => {
		const row = running(2)
		const status = { ...row.status, state: 'running' as const, phase_ms: undefined }

		expect(quiet_tail({ ...row, status }, { usual: usual(1) })).toBe(
			`${ICON_BLANK} ${' '.repeat('0″'.length)}`,
		)
	})

	it('draws seconds alone and carries the minutes into hours', () => {
		expect(phase_time(SECONDS_40)).toBe('👀 40″')
		expect(phase_time(MINUTES_61_SECONDS_5)).toBe('👀 1°01′05″')
	})
})

describe('run_board_render_tail.tail_of activity', () => {
	it('draws ` · `, the newest event’s phase icon and its age after the phase time', () => {
		expect(tail(running(1))).toStrictEqual([`${PHASE_PART} · 👀 3′00″`])
	})

	it('draws 🔧 where the newest operation is newer than the newest event', () => {
		expect(quiet_tail(running(1), { operations: operations(1, NOW - MINUTE) })).toBe(
			`${PHASE_PART} · 🔧 1′00″`,
		)
	})

	it('ages the activity as the 💓 is: plain, yellow past 15 minutes, red past 30', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(operated_activity(5)).toBe(`${PHASE_PART} · 🔧 5′00″`)
		expect(operated_activity(20)).toBe(`${PHASE_PART} · ${styleText('yellow', '🔧 20′00″')}`)
		expect(operated_activity(40)).toBe(`${PHASE_PART} · ${styleText('red', '🔧 40′00″')}`)
	})

	it('draws no activity where the newest is the event that entered the phase', () => {
		const row = phased(running(1), 3 * MINUTE)

		expect(quiet_tail(row)).toBe('👀 3′00″')
		expect(run_board_render_tail.activity_icon(row, board())).toBeUndefined()
	})

	it('right-aligns the activity’s age to the widest any running row draws', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running(1), running(2)] }
		const extra = { layout, operations: operations(2, NOW - MINUTES_61_SECONDS_5) }

		expect(quiet_tail(running(1), extra)).toBe(`${PHASE_PART} · 👀    3′00″`)
	})

	it('draws nothing after a settled or a waiting row', () => {
		const settled: BoardRow = { ...running(1), state: 'merged' }
		const waiting: BoardRow = { ...running(1), state: 'waiting', status: undefined }

		expect(tail(settled)).toStrictEqual([])
		expect(tail(waiting)).toStrictEqual([])
	})
})

describe('run_board_render_tail.activity_icon', () => {
	it('is the newest activity’s icon, only for a running row', () => {
		const operated = board({ operations: operations(1, NOW - MINUTE) })

		expect(run_board_render_tail.activity_icon(running(1), operated)).toBe('🔧')
		expect(run_board_render_tail.activity_icon(running(1), board())).toBe('👀')
		expect(
			run_board_render_tail.activity_icon({ ...running(1), state: 'merged' }, operated),
		).toBeUndefined()
	})
})

// The columns before `marker` on the line that holds `title`, as the terminal counts them.
function column_of(lines: ReadonlyArray<string>, title: string, marker: string): number {
	const line = lines.find((text) => text.includes(title)) ?? ''

	return run_board_fit.width_of(line.slice(0, line.indexOf(marker)))
}

function tail_lines(extra: Partial<BoardHeader> = {}): Array<string> {
	const waiting: BoardRow = { ...running(3, 'Waiting'), state: 'waiting', status: undefined }
	const layout = {
		...EMPTY_LAYOUT,
		active: [running(1, 'Short'), running(2, 'A much longer title than the other')],
		unreached: [{ ...waiting, waits: ['9'] }],
	}

	return lines_of(board({ layout, ...extra }))
}

describe('run_board_render.render tail column', () => {
	it('starts every running row’s phase time in one column whatever its title', () => {
		const lines = tail_lines()

		expect(column_of(lines, 'Short', PHASE_TIME)).toBe(column_of(lines, 'A much', PHASE_TIME))
	})

	it('starts every running row’s activity in one column where one phase time runs past an hour', () => {
		const long = phased(running(2, 'Long'), LONG_PHASE)
		const layout = { ...EMPTY_LAYOUT, active: [running(1, 'Short'), long] }
		const lane_events = new Map([
			[1, EVENT],
			[2, EVENT],
		])
		const lines = lines_of(board({ layout, activity: { ...board().activity, lane_events } }))

		expect(column_of(lines, 'Long', ' · ')).toBe(column_of(lines, 'Short', ' · '))
		expect(column_of(lines, 'Long', '2°05′00″')).toBe(column_of(lines, 'Short', PHASE_TIME) - 2)
	})

	it('ends every running row’s activity age in one column where one runs past an hour', () => {
		const lines = tail_lines({ operations: operations(2, NOW - MINUTES_61_SECONDS_5) })
		const short_end = column_of(lines, 'Short', '3′00″') + '3′00″'.length
		const long_end = column_of(lines, 'A much', '1°01′05″') + '1°01′05″'.length

		expect(short_end).toBe(long_end)
	})

	// joshuafolkken/kit#4026: a waiting row lines nothing up, so its 🔗 follows its title.
	it('starts a waiting row’s 🔗 two blanks after its title', () => {
		const line = tail_lines().find((text) => text.includes('Waiting'))

		expect(line).toMatch(/Waiting {2}🔗 /u)
	})

	// The header's third line says the run has ended, so only the row's tail draws 🔧.
	it('names 🔧 in the legend where a row draws it and the header does not', () => {
		const latest = { text: 'ended', at_ms: NOW - MINUTE }
		const activity = { ...board().activity, is_stopped: true, latest }
		const lines = tail_lines({ operations: operations(1, NOW - MINUTE), activity })

		expect(stripVTControlCharacters(lines.slice(-2).join('\n'))).toContain('🔧 operation')
		expect(stripVTControlCharacters(lines.slice(0, 3).join('\n'))).not.toContain('🔧')
	})
})
