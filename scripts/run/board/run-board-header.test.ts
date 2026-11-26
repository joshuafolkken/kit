import { stripVTControlCharacters } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import string_width from 'string-width'
import { describe, expect, it } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_spot } from './run-board-spot'

// joshuafolkken/kit#3430: the board's top lines — which state wins, what the plan line says when a
// fetch has failed, and how the progress counts are drawn from the layout. joshuafolkken/kit#3444: two
// lines of symbols, no `updated` line. joshuafolkken/kit#8475: a quiet heartbeat said in the slot.
// joshuafolkken/kit#3508: the run's state with its progress, then the time with the machine.
// joshuafolkken/kit#8478: three lines in four columns, the time circuits — the names; the finish over
// now over the start; what is left over the run's age over the spinner and the third line's age; the
// machine over the notice slot over what the run is doing now.

const { minute_of } = run_board_labels
const { HEADER_ICONS } = run_board_labels
const MINUTE = MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 30 * MINUTE
const MACHINE_UNKNOWN = '💪 -  🧠 -  💾 -'
// The third line's name column where no repository is read, and the second line's where no kit
// version is: `-` under the board's name. The names column is at least 15 columns (joshuafolkken/kit#8917).
const NAMES_WIDTH = 15
const NAME_BLANK = ' '.repeat(NAMES_WIDTH)
const VERSION_CELL = '  -'.padEnd(NAME_BLANK.length)
const BOARD_NAME = '⏸ josh-board'.padEnd(NAMES_WIDTH)
const RUNNING_NAME = '▶ josh-board'.padEnd(NAMES_WIDTH)
// A time cell: one sign — or the spinner — then eight columns.
const TIME_WIDTH = 9
const TIME_BLANK = ' '.repeat(TIME_WIDTH)
// The notice slot before any notice, where nothing holds (joshuafolkken/kit#8475).
const SLOT_BLANK = '  —'
// The first line where no finish is estimated: the finish and what is left unknown, then the machine.
const UNKNOWN_FINISH = '🎯 --:--  -  --′--″'
const IDLE_TITLE = `${BOARD_NAME}  ${UNKNOWN_FINISH}  ${MACHINE_UNKNOWN}`
const RUNNING_TITLE = `${RUNNING_NAME}  ${UNKNOWN_FINISH}  ${MACHINE_UNKNOWN}`
const RUNNING_CLOCK = `${VERSION_CELL}  🕒 ${minute_of(NOW)}  +  30′00″${SLOT_BLANK}`
// joshuafolkken/kit#3749: the third line — the start alone where the stream holds no event, else
// what the run is doing now: its time under the signed column, its icon and words after it.
const NOW_BLANK = `${NAME_BLANK}  🚀 ${minute_of(STARTED)}`
const ONE_RUNNING = `${NOW_BLANK}  ${TIME_BLANK}  🔄 1 running`
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const RUNNING_LAYOUT: BoardLayout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		is_investigation_on: false,
		spinner: undefined,
		form: 'screen',
		repo: undefined,
		link: (reference) => reference,
		pull_link: String,
		repo_link: String,
		...extra,
	}
}

// The header's lines with a live frame's clock colons drawn lit (joshuafolkken/kit#8476).
function lines_of(board: BoardHeader): Array<string> {
	return run_board_header
		.header_lines(board)
		.map((line) => stripVTControlCharacters(run_board_spot.drawn(line, run_board_spot.SPOT)))
}

function title_of(board: BoardHeader): string {
	return lines_of(board)[0] ?? ''
}

function clock_line_of(board: BoardHeader): string {
	return lines_of(board)[1] ?? ''
}

describe('run_board_header.header_lines state', () => {
	it('draws an ended run as ended even with a child still marked running', () => {
		const activity = { last_event_ms: undefined, is_stopped: true }

		expect(title_of(header({ layout: RUNNING_LAYOUT, activity }))).toMatch(/^■ josh-board/u)
	})

	it('draws a running run as running and a plan left only to people as waiting on a person', () => {
		const human = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		expect(title_of(header({ layout: RUNNING_LAYOUT }))).toMatch(/^▶ josh-board/u)
		expect(title_of(header({ layout: human }))).toMatch(/^✋ josh-board/u)
		expect(title_of(header())).toMatch(/^⏸ josh-board/u)
	})

	// joshuafolkken/kit#3439, joshuafolkken/kit#3450; joshuafolkken/kit#8478: the finish is when it
	// ended, none left, its age stopped at its end, and `—` in the third time cell.
	it('draws an ended run with how long it took and the minute it ended, and no heartbeat', () => {
		const ended_ms = STARTED + 90 * MINUTE
		const now_ms = ended_ms + 10 * MINUTE
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const board = header({ activity, ended_ms, now_ms })

		expect(lines_of(board)).toStrictEqual([
			`${'■ josh-board'.padEnd(NAMES_WIDTH)}  🎯 ${minute_of(ended_ms)}  -      0″  ${MACHINE_UNKNOWN}`,
			`${VERSION_CELL}  🕒 ${minute_of(now_ms)}  +1°30′00″${SLOT_BLANK}`,
			`${NOW_BLANK}  ${'—'.padStart(TIME_WIDTH)}`,
		])
	})

	it('leaves out the heartbeat before the stream has one', () => {
		expect(lines_of(header()).join('\n')).not.toContain('💓')
	})
})

describe('run_board_header.header_lines shape', () => {
	// joshuafolkken/kit#8478: what is left over the run's age, the start alone under them while the
	// stream holds no event; the heartbeat is said in the slot (#8475).
	it('draws what is left over the run’s age, the start alone on the third line', () => {
		const activity = { last_event_ms: NOW - MINUTE, is_stopped: false }

		expect(lines_of(header({ activity }))).toStrictEqual([IDLE_TITLE, RUNNING_CLOCK, NOW_BLANK])
	})

	// joshuafolkken/kit#3486: two lines in every state, a machine not sampled yet drawn as `-`;
	// joshuafolkken/kit#8514: the tallies are the lanes rule's, not the first line's.
	it('draws the state, then the machine, with no tally and no updated line', () => {
		const layout = { ...RUNNING_LAYOUT, unreached: [row(2, 'waiting')] }

		expect(lines_of(header({ layout }))).toStrictEqual([RUNNING_TITLE, RUNNING_CLOCK, ONE_RUNNING])
	})

	// joshuafolkken/kit#3450; joshuafolkken/kit#8478: at the first line's end, its bars five cells.
	it('draws the machine gauges at the first line’s end', () => {
		const machine = {
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3.1,
			memory_pressure: undefined,
		}

		expect(title_of(header({ machine }))).toBe(
			`${BOARD_NAME}  ${UNKNOWN_FINISH}  💪  15% ■────  🧠  37% ■■───  💾 3.1M/s ■────`,
		)
	})
})

describe('run_board_header.header_lines spinner', () => {
	// joshuafolkken/kit#3452, joshuafolkken/kit#3767: the mark stands still in every state; the spinner
	// turns on the third line, in the signs' column (joshuafolkken/kit#8478).
	it('turns the spinner on the third line of a running run, never in place of its mark', () => {
		const board = header({ layout: RUNNING_LAYOUT, spinner: '⠙' })

		expect(title_of(board)).toMatch(/^▶ josh-board/u)
		expect(lines_of(board)[2]).toBe(`${NOW_BLANK}  ⠙${' '.repeat(TIME_WIDTH - 1)}  🔄 1 running`)
	})
})

describe('run_board_header.header_lines before the plan is read', () => {
	// joshuafolkken/kit#3486: before the plan is read the run's own children are counted, and what only
	// the plan knows — the total and what waits — is `-`, not a `0` that reads as nothing.
	it('draws its lines, with - for what only the plan knows', () => {
		const board = header({ layout: RUNNING_LAYOUT, plan_fetched_ms: undefined })

		expect(lines_of(board)).toStrictEqual([RUNNING_TITLE, RUNNING_CLOCK, ONE_RUNNING])
		expect(run_board_header.lanes_tail(board)).toBe('✅ 0/-  🔄 1  💤 0')
	})

	it('draws three lines with no layout at all', () => {
		expect(lines_of(header({ layout: undefined }))).toHaveLength(3)
	})
})

// joshuafolkken/kit#3456: a figure read once means nothing, so a chat's machine line is its memory.
describe('run_board_header.header_lines chat', () => {
	it('draws the memory alone at the first line’s end of a chat', () => {
		const machine = {
			cpu_percent: 15,
			memory_percent: 37,
			swap_mb_per_s: 3.1,
			memory_pressure: undefined,
		}

		expect(title_of(header({ machine, form: 'chat' }))).toBe(
			`${BOARD_NAME}  ${UNKNOWN_FINISH}  🧠  37% ■■───`,
		)
	})
})

describe('run_board_header.header_lines plan warning', () => {
	it('says nothing about a plan read that succeeded', () => {
		expect(title_of(header({ plan_fetched_ms: NOW }))).not.toContain(HEADER_ICONS.warning)
	})

	// joshuafolkken/kit#8475: a failed plan read is said in the notice slot, not on the first line.
	it('says a failed plan read in the notice slot, stale since the plan last landed', () => {
		const board = header({ plan_fetched_ms: NOW - MINUTE, plan_failed_ms: NOW })

		expect(title_of(board)).toBe(IDLE_TITLE)
		expect(clock_line_of(board)).toMatch(/ {2}❗ stale 1′00″ · retrying$/u)
	})

	// joshuafolkken/kit#4223: ⚠ is counted one column wide but drawn two, over the blank after it.
	it('warns with an icon two columns wide', () => {
		expect(string_width(HEADER_ICONS.warning)).toBe(2)
	})
})

// joshuafolkken/kit#3455: a plan read in flight turns the spinner after ⏳, on a terminal only — on the
// queued rule's end, not the first line (joshuafolkken/kit#8512).
describe('run_board_header.queued_tail plan loading', () => {
	const { queued_tail } = run_board_header

	it('turns the spinner after ⏳ while the plan read is in flight', () => {
		expect(queued_tail(header({ is_plan_loading: true, spinner: '⠙' }))).toBe('⏳ ⠙')
	})

	it('draws nothing for it once the read landed or where there is no spinner', () => {
		expect(queued_tail(header({ is_plan_loading: false, spinner: '⠙' }))).toBeUndefined()
		expect(queued_tail(header({ is_plan_loading: true, spinner: undefined }))).toBeUndefined()
	})

	it('draws no spinner on the first line', () => {
		expect(title_of(header({ is_plan_loading: true, spinner: '⠙' }))).toBe(IDLE_TITLE)
	})
})

// joshuafolkken/kit#8475: a quiet heartbeat is said in the notice slot, waiting or working alike.
describe('run_board_header.header_lines heartbeat', () => {
	it('says no heartbeat in the slot once the run is quiet past its interval and half again', () => {
		const quiet = { last_event_ms: NOW - 40 * MINUTE, is_stopped: false }
		const beating = { last_event_ms: NOW - MINUTE, is_stopped: false }

		expect(clock_line_of(header({ activity: quiet }))).toMatch(/ {2}❗ no heartbeat 40′$/u)
		expect(clock_line_of(header({ activity: beating }))).toBe(RUNNING_CLOCK)
	})
})

// The lanes rule's tail of a plan with `settled` of its `total` rows settled — one of them parked, the
// rest merged — one running and the rest waiting.
function tail_of(settled: number, total: number, extra: Partial<BoardHeader> = {}): string {
	const merged = Array.from({ length: settled - 1 }, (_, index) => row(index + 1, 'merged'))
	const waiting = Array.from({ length: total - settled - 1 }, (_, index) =>
		row(100 + index, 'waiting'),
	)
	const active = [...merged, row(90, 'running'), row(91, 'parked')]
	const layout = { ...EMPTY_LAYOUT, active, unreached: waiting }

	return stripVTControlCharacters(run_board_header.lanes_tail(header({ layout, ...extra })))
}

// joshuafolkken/kit#8514: what has settled, what runs, what is parked, then the issue count, at the
// lanes rule's end; no bar and no `(+N)`.
describe('run_board_header.lanes_tail', () => {
	it('draws ✅ the count over the total, then running and parked, with no bar', () => {
		expect(tail_of(9, 12)).toBe('✅ 9/12  🔄 1  💤 1')
	})

	it('draws the issue count last', () => {
		const issue_count = { open: 78, closed: 4489 }

		expect(tail_of(7, 47, { repo: 'o/r', issue_count })).toBe('✅ 7/47  🔄 1  💤 1  📮 78/4,489')
	})

	it('draws the total as - before the plan is read', () => {
		expect(tail_of(1, 3, { plan_fetched_ms: undefined })).toBe('✅ 1/-  🔄 1  💤 1')
	})

	it('draws no tally on the first line', () => {
		expect(title_of(header({ repo: 'o/r', issue_count: { open: 1, closed: 2 } }))).not.toMatch(
			/[✅🔄💤📮]/u,
		)
	})
})

// joshuafolkken/kit#8219: a saved plan's age is drawn until a fresh plan lands — on the queued rule's
// end, after a plan read in flight, not on the first line (joshuafolkken/kit#8512).
describe('run_board_header.queued_tail saved plan', () => {
	const { queued_tail } = run_board_header
	const saved = header({ plan_saved_ms: NOW - 2 * MINUTE })

	it('says 🕘 and the saved plan’s age', () => {
		expect(queued_tail(saved)).toMatch(/^🕘 \S+$/u)
	})

	it('draws the spinner first, then the age', () => {
		const both = header({ plan_saved_ms: NOW - 2 * MINUTE, is_plan_loading: true, spinner: '⠋' })

		expect(queued_tail(both)).toMatch(/^⏳ ⠋ {2}🕘 \S+$/u)
	})

	it('draws no 🕘 for a fresh plan', () => {
		expect(queued_tail(header())).toBeUndefined()
	})

	it('draws no 🕘 on the first line', () => {
		expect(title_of(saved)).toBe(IDLE_TITLE)
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
			queued: [epic, { kind: 'row', row: row(5, 'waiting') }],
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
