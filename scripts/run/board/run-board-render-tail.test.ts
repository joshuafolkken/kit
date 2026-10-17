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

// joshuafolkken/kit#3769: a running row ends on how long it has stood at its phase — colored against
// the phase's usual time — then the kind and the age of its newest activity, both in one column on
// every row; a waiting row's blockers start in that column too.

const { EMPTY_LAYOUT, MINUTE, NOW, header, lines_of } = run_board_render_fixture
const PHASE_TIME = '10′00″'
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

// The phase time of a row that reached its phase `ago_ms` before now.
function phase_time(ago_ms: number): string | undefined {
	return tail(phased(running(1), ago_ms))[0]
}

// Row 2 has no event of its own, so its newest activity is the operation `minutes` old.
function operated_activity(minutes: number): string | undefined {
	return tail(running(2), { operations: operations(2, NOW - minutes * MINUTE) })[1]
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_render_tail.tail_of phase time', () => {
	it('draws how long the child has stood at its phase as a span, plain without a usual time', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(tail(running(1))[0]).toBe(PHASE_TIME)
	})

	it('draws it plain up to twice the usual time, yellow past it and red past three times', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(tail(running(1), { usual: usual(5) })[0]).toBe(PHASE_TIME)
		expect(tail(running(1), { usual: usual(4) })[0]).toBe(styleText('yellow', PHASE_TIME))
		expect(tail(running(1), { usual: usual(3) })[0]).toBe(styleText('red', PHASE_TIME))
	})

	it('counts a near-zero usual time as two minutes, so a stage of seconds is not drawn as alarming', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const row = running(1)

		function at(minutes: number): string | undefined {
			const status = { ...row.status, state: 'running' as const, phase_ms: NOW - minutes * MINUTE }

			return tail({ ...row, status }, { usual: usual(0) })[0]
		}

		expect(at(3)).toBe('3′00″')
		expect(at(5)).toBe(styleText('yellow', '5′00″'))
		expect(at(7)).toBe(styleText('red', '7′00″'))
	})

	it('draws blanks where no event said when the child got to its phase', () => {
		const row = running(1)
		const status = { ...row.status, state: 'running' as const, phase_ms: undefined }

		expect(tail({ ...row, status }, { usual: usual(1) })[0]).toBe(' '.repeat('0″'.length))
	})

	it('draws seconds alone and carries the minutes into hours', () => {
		expect(phase_time(SECONDS_40)).toBe('40″')
		expect(phase_time(MINUTES_61_SECONDS_5)).toBe('1°01′05″')
	})
})

describe('run_board_render_tail.tail_of activity', () => {
	it('draws the newest event’s phase icon and its age', () => {
		expect(tail(running(1))[1]).toBe('👀 3′00″')
	})

	it('draws 🔧 where the newest operation is newer than the newest event', () => {
		expect(tail(running(1), { operations: operations(1, NOW - MINUTE) })[1]).toBe('🔧 1′00″')
	})

	it('ages the activity as the 💓 is: plain, yellow past 15 minutes, red past 30', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(operated_activity(10)).toBe('🔧 10′00″')
		expect(operated_activity(20)).toBe(styleText('yellow', '🔧 20′00″'))
		expect(operated_activity(40)).toBe(styleText('red', '🔧 40′00″'))
	})

	it('draws nothing after a settled or a waiting row', () => {
		const settled: BoardRow = { ...running(1), state: 'merged' }
		const waiting: BoardRow = { ...running(1), state: 'waiting', status: undefined }

		expect(tail(settled)).toStrictEqual([])
		expect(tail(waiting)).toStrictEqual([])
	})
})

describe('run_board_render_tail.is_operation_drawn', () => {
	it('is true only for a running row whose newest activity is an operation', () => {
		const operated = board({ operations: operations(1, NOW - MINUTE) })

		expect(run_board_render_tail.is_operation_drawn(running(1), operated)).toBe(true)
		expect(run_board_render_tail.is_operation_drawn(running(1), board())).toBe(false)
		expect(
			run_board_render_tail.is_operation_drawn({ ...running(1), state: 'merged' }, operated),
		).toBe(false)
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

		expect(column_of(lines, 'Long', '👀')).toBe(column_of(lines, 'Short', '👀'))
		expect(column_of(lines, 'Long', '2°05′00″')).toBe(column_of(lines, 'Short', PHASE_TIME) - 2)
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

		expect(stripVTControlCharacters(lines.at(-1) ?? '')).toContain('🔧 operation')
		expect(stripVTControlCharacters(lines.slice(0, 3).join('\n'))).not.toContain('🔧')
	})
})
