import { stripVTControlCharacters, styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'

// joshuafolkken/kit#3430: the board's top lines — which state wins, what the plan line says when a
// fetch has failed, and how the progress counts are drawn from the layout. joshuafolkken/kit#3444: two
// lines of symbols, no `updated` line, and a heartbeat colored by how stale the stream is.
// joshuafolkken/kit#3508: the run's state with its progress, then the time with the machine.
// joshuafolkken/kit#3692: three columns — the name, the time, then the progress over the machine.

const { minute_of } = run_board_labels
const { WORDS } = run_board_labels
const MACHINE_UNKNOWN = '💪 -  🧠 -  💾 -'
// The second line's first two columns where nothing is drawn in them: no repository, no heartbeat.
const NAME_BLANK = ' '.repeat('⏸ backlogrun'.length)
const TIME_BLANK = ' '.repeat('⏰ 30′00″'.length + 1)
const RUNNING_CLOCK = `${NAME_BLANK}  ${TIME_BLANK}  ${MACHINE_UNKNOWN}`
// joshuafolkken/kit#3749: the third line — blank where the stream holds no event, else what the run is
// doing now: its time under the second column, its icon and words under the third.
const NOW_BLANK = ''
const ONE_RUNNING = `${NAME_BLANK}  ${TIME_BLANK}  🔄 1 running`
const STALE_BEAT = '💓 40′00″'
const EMPTY_BAR = '─'.repeat(10)
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 30 * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const RUNNING_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }

// A 40-minute heartbeat drawn alarming — read at the call, after the case has forced color on.
function alarmed(): string {
	return styleText('red', STALE_BEAT)
}

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		spinner: undefined,
		form: 'screen',
		repo: undefined,
		link: (reference) => reference,
		...extra,
	}
}

function lines_of(board: BoardHeader): Array<string> {
	return run_board_header.header_lines(board).map((line) => stripVTControlCharacters(line))
}

function title_of(board: BoardHeader): string {
	return lines_of(board)[0] ?? ''
}

function clock_line_of(board: BoardHeader): string {
	return lines_of(board)[1] ?? ''
}

// The raw second line, colors kept, of a running run whose newest event is `age_ms` old.
function aged_beat(age_ms: number): string {
	const activity = { last_event_ms: NOW - age_ms, is_stopped: false }

	return run_board_header.header_lines(header({ layout: RUNNING_LAYOUT, activity }))[1] ?? ''
}

describe('run_board_header.header_lines state', () => {
	it('draws an ended run as ended even with a child still marked running', () => {
		const activity = { last_event_ms: undefined, is_stopped: true }

		expect(title_of(header({ layout: RUNNING_LAYOUT, activity }))).toMatch(/^■ backlogrun/u)
	})

	it('draws a running run as running and a plan left only to people as waiting on a person', () => {
		const human = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		expect(title_of(header({ layout: RUNNING_LAYOUT }))).toMatch(/^▶ backlogrun/u)
		expect(title_of(header({ layout: human }))).toMatch(/^✋ backlogrun/u)
		expect(title_of(header())).toMatch(/^⏸ backlogrun/u)
	})

	// joshuafolkken/kit#3439, joshuafolkken/kit#3450
	it('draws an ended run with how long it took and the minute it ended, and no heartbeat', () => {
		const ended_ms = STARTED + 90 * MINUTE
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const board = header({ activity, ended_ms, now_ms: ended_ms + 10 * MINUTE })

		expect(lines_of(board)).toStrictEqual([
			`■ backlogrun  ⏰ 1°30′00″  ✅  0/0 ${EMPTY_BAR}  🔄 0  ⏳ 0  💤 0`,
			`${NAME_BLANK}  🔚 ${minute_of(ended_ms)}     ${MACHINE_UNKNOWN}`,
			NOW_BLANK,
		])
	})

	it('leaves out the heartbeat before the stream has one', () => {
		expect(lines_of(header()).join('\n')).not.toContain('💓')
	})
})

describe('run_board_header.header_lines shape', () => {
	// joshuafolkken/kit#3692: the run's age over the heartbeat, in one column.
	it('draws the run’s age then the progress on the first line, the heartbeat under the age', () => {
		const activity = { last_event_ms: NOW - MINUTE, is_stopped: false }

		expect(lines_of(header({ activity }))).toStrictEqual([
			`⏸ backlogrun  ⏰ 30′00″  ✅  0/0 ${EMPTY_BAR}  🔄 0  ⏳ 0  💤 0`,
			`${NAME_BLANK}  💓  1′00″  ${MACHINE_UNKNOWN}`,
			NOW_BLANK,
		])
	})

	// joshuafolkken/kit#3486: two lines in every state, a machine not sampled yet drawn as `-`.
	it('draws the state with the progress bar, then the machine, with no updated line', () => {
		const layout = { ...RUNNING_LAYOUT, unreached: [row(2, 'waiting')] }

		expect(lines_of(header({ layout }))).toStrictEqual([
			`▶ backlogrun  ⏰ 30′00″  ✅  0/2 ${EMPTY_BAR}  🔄 1  ⏳ 1  💤 0`,
			RUNNING_CLOCK,
			ONE_RUNNING,
		])
	})

	// joshuafolkken/kit#3450
	it('draws the machine gauges under the progress', () => {
		const machine = {
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3.1,
			memory_pressure: undefined,
		}

		expect(clock_line_of(header({ machine }))).toBe(
			`${NAME_BLANK}  ${TIME_BLANK}  💪  15% ■■────────  🧠  37% ■■■■──────  💾 3.1M/s ■■────────`,
		)
	})
})

describe('run_board_header.header_lines spinner', () => {
	// joshuafolkken/kit#3452, joshuafolkken/kit#3767: the mark stands still in every state; the spinner
	// turns on the third line, under the `⏰`.
	it('turns the spinner on the third line of a running run, never in place of its mark', () => {
		const board = header({ layout: RUNNING_LAYOUT, spinner: '⠙' })

		expect(title_of(board)).toMatch(/^▶ backlogrun/u)
		expect(lines_of(board)[2]).toBe(
			`${NAME_BLANK}  ⠙${' '.repeat(TIME_BLANK.length - 1)}  🔄 1 running`,
		)
	})
})

describe('run_board_header.header_lines before the plan is read', () => {
	// joshuafolkken/kit#3486: before the plan is read the run's own children are counted, and what only
	// the plan knows — the total and what waits — is `-`, not a `0` that reads as nothing.
	it('draws its lines, with - for what only the plan knows', () => {
		const board = header({ layout: RUNNING_LAYOUT, plan_fetched_ms: undefined, baseline_total: 0 })

		expect(lines_of(board)).toStrictEqual([
			`▶ backlogrun  ⏰ 30′00″  ✅  0/- ${EMPTY_BAR}  🔄 1  ⏳ -  💤 0`,
			RUNNING_CLOCK,
			ONE_RUNNING,
		])
	})

	it('draws three lines with no layout at all', () => {
		expect(lines_of(header({ layout: undefined }))).toHaveLength(3)
	})
})

// joshuafolkken/kit#3456: a figure read once means nothing, so a chat's machine line is its memory.
describe('run_board_header.header_lines chat', () => {
	it('draws the memory alone under the progress of a chat', () => {
		const machine = {
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3.1,
			memory_pressure: undefined,
		}

		expect(clock_line_of(header({ machine, form: 'chat' }))).toBe(
			`${NAME_BLANK}  ${TIME_BLANK}  🧠  37% ■■■■──────`,
		)
	})
})

describe('run_board_header.header_lines plan warning', () => {
	it('says nothing about a plan read that succeeded', () => {
		expect(title_of(header({ plan_fetched_ms: NOW }))).not.toContain('⚠')
	})

	it('warns with the minute of a failed plan read', () => {
		const board = header({ plan_fetched_ms: NOW - MINUTE, plan_failed_ms: NOW })

		expect(title_of(board)).toMatch(new RegExp(`💤 0  ⚠ ${WORDS.plan} ${minute_of(NOW)}$`, 'u'))
	})
})

// joshuafolkken/kit#3455: a plan read in flight turns the spinner after ⏳, on a terminal only.
describe('run_board_header.header_lines plan loading', () => {
	it('turns the spinner after ⏳ while the plan read is in flight', () => {
		expect(title_of(header({ is_plan_loading: true, spinner: '⠙' }))).toMatch(/💤 0 {2}⏳ ⠙$/u)
	})

	it('draws nothing for it once the read landed or where there is no spinner', () => {
		expect(title_of(header({ is_plan_loading: false, spinner: '⠙' }))).not.toContain('⏳ ⠙')
		expect(title_of(header({ is_plan_loading: true, spinner: undefined }))).toMatch(/💤 0$/u)
	})
})

describe('run_board_header.header_lines heartbeat color', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('leaves a fresh heartbeat plain, then yellow past 15 minutes and red past 30', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		expect(aged_beat(MINUTE)).toContain(' 💓  1′00″')
		expect(aged_beat(20 * MINUTE)).toContain(styleText('yellow', '💓 20′00″'))
		expect(aged_beat(40 * MINUTE)).toContain(alarmed())
	})

	it('leaves a stale heartbeat plain while the run is not running', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const activity = { last_event_ms: NOW - 40 * MINUTE, is_stopped: false }
		const beat = run_board_header.header_lines(header({ activity }))[1] ?? ''

		expect(beat).toContain(STALE_BEAT)
		expect(beat).not.toContain(alarmed())
	})
})

// The progress line of a plan with `settled` of its `total` rows merged and the rest waiting.
function progress_of(settled: number, total: number): string {
	const merged = Array.from({ length: settled }, (_, index) => row(index + 1, 'merged'))
	const waiting = Array.from({ length: total - settled }, (_, index) => row(100 + index, 'waiting'))
	const layout = { ...EMPTY_LAYOUT, active: merged, unreached: waiting }

	return title_of(header({ layout })).replace(/^\S+ backlogrun {2}⏰ \S+ {2}/u, '')
}

// joshuafolkken/kit#3473: icon, count, then bar, as the machine gauges; the done count drawn once.
describe('run_board_header.header_lines progress', () => {
	it('draws ✅, the count over the total, the bar, then running, waiting and parked', () => {
		expect(progress_of(9, 12)).toBe(`✅  9/12 ${'■'.repeat(8)}${'─'.repeat(2)}  🔄 0  ⏳ 3  💤 0`)
	})

	it('starts the bar in one column as the count gains a digit', () => {
		const short = progress_of(9, 12)
		const long = progress_of(12, 12)

		expect(short.indexOf('■')).toBe(long.indexOf('■'))
		expect(long).toMatch(/^✅ 12\/12 ■/u)
	})

	it('draws the done count once', () => {
		expect(progress_of(9, 12).split('✅')).toHaveLength(2)
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
			parked: 1,
			running: 1,
			remaining: 5,
		})
	})

	// joshuafolkken/kit#3459: a lane child its labels say stopped is not counted as running.
	it('leaves a stopped or decision-waiting active row out of the running count', () => {
		const active = [row(1, 'running'), row(2, 'stopped'), row(3, 'human')]
		const counts = run_board_header.counts_of({ ...EMPTY_LAYOUT, active })

		expect(counts).toMatchObject({ running: 1, settled: 0, remaining: 2 })
	})
})
