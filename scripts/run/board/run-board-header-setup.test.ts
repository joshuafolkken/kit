import { stripVTControlCharacters, styleText } from 'node:util'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { RunActivity } from './run-board-status'

// joshuafolkken/kit#3696: the header while the run is at a stage of its own. joshuafolkken/kit#3767:
// the mark stands still; the spinner turns on the third line, before the stage's time and icon.
// joshuafolkken/kit#3749: the stage stands on the third line, its time under the second column, whenever the run
// is at one; the first line is the progress in every state.

const SECOND = 1000
const STARTED = Date.parse('2026-10-12T09:00:00.000Z')
const NOW = STARTED + 10 * SECOND
const SPINNER = '⠋'
const { STAGE } = run_event_setup
const OPENING = run_event_setup.opening_lane('278')
const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }
const STALE_MS = 40 * MS_PER_MINUTE
const STAGE_AGE_MS = 151 * SECOND
// The third line's blank under the run's mark and name, then the gap before its words.
const NOW_INDENT = ' '.repeat('▶ backlogrun'.length + 2)
const PROGRESS_0_OF_1 = /^▶ backlogrun {2}⏰ 10″ {2}✅ +0\/1 /u
const JUDGING_LINE = '⠋  2′31″  🤔 waiting on judgment — 1 waiting'

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const ONE_PLANNED: BoardLayout = { ...EMPTY_LAYOUT, active: [row(278, 'waiting')] }
const ONE_RUNNING: BoardLayout = { ...EMPTY_LAYOUT, active: [row(278, 'running')] }
const NEXT_OPENING: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [row(278, 'merged'), row(279, 'waiting')],
}
const PEOPLE: BoardLayout = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

// The run at `setup`, a stage it entered `age_ms` ago.
function standing(setup: string, age_ms = 0): RunActivity {
	return { setup, setup_ms: NOW - age_ms, last_event_ms: NOW - age_ms, is_stopped: false }
}

// The run at no stage, the newest thing it did a merge `age_ms` ago.
function merged(age_ms = 0): RunActivity {
	const at_ms = NOW - age_ms

	return {
		last_event_ms: at_ms,
		is_stopped: false,
		latest: { text: '#278 merged', at_ms },
		idle_ms: at_ms,
	}
}

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: standing(STAGE.STARTING),
		layout: undefined,
		baseline_total: undefined,
		plan_fetched_ms: undefined,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		is_investigation_on: false,
		spinner: SPINNER,
		form: 'screen',
		repo: 'joshuafolkken/app-kit',
		link: (reference) => reference,
		pull_link: String,
		...extra,
	}
}

// A header whose plan has been read.
function planned(layout: BoardLayout, activity: RunActivity): BoardHeader {
	return header({ layout, activity, plan_fetched_ms: NOW })
}

function lines_of(board: BoardHeader): Array<string> {
	return run_board_header.header_lines(board).map((line) => stripVTControlCharacters(line))
}

function title_of(board: BoardHeader): string {
	return lines_of(board)[0] ?? ''
}

// The third line's words, past the blank under the name — as wide as the mark before it is drawn.
function now_of(board: BoardHeader): string {
	return (lines_of(board)[2] ?? '').trimStart()
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_header.header_lines before the first child launches', () => {
	it('draws the progress, and turns the spinner beside the stage on the third line', () => {
		const [first, second, third] = lines_of(header())

		expect(first).toMatch(/^▶ backlogrun {2}⏰ 10″ {2}✅ +0\/- /u)
		expect(first).not.toContain(STAGE.STARTING)
		expect(second).toMatch(/^ {2}app-kit {5}💓 /u)
		expect(third).toBe(`${NOW_INDENT}⠋   0″  🚀 starting session`)
	})

	it('draws the still mark of a working run where the frame has no spinner', () => {
		expect(title_of(header({ spinner: undefined }))).toMatch(/^▶ backlogrun /u)
	})

	it('draws the progress bar on the first line once the plan is read', () => {
		const board = planned(ONE_PLANNED, standing(STAGE.HANDING_OFF))

		expect(title_of(board)).toMatch(PROGRESS_0_OF_1)
		expect(now_of(board)).toBe('⠋   0″  🤝 handing off — 1 waiting')
	})

	it('keeps the first two lines where they are whatever the stage’s length', () => {
		const short = lines_of(planned(ONE_PLANNED, standing(STAGE.PLANNING)))
		const long = lines_of(planned(ONE_PLANNED, standing(OPENING)))

		expect(long.slice(0, 2)).toStrictEqual(short.slice(0, 2))
		expect(long[2]).not.toBe(short[2])
	})

	it('says a plan read failed on the first line, not after the stage', () => {
		const board = header({ plan_failed_ms: NOW })

		expect(title_of(board)).toMatch(/ {2}❗ /u)
		expect(now_of(board)).toBe('⠋   0″  🚀 starting session')
	})
})

// joshuafolkken/kit#3738: how long the run has stood at its stage, counted from the stage's own event.
describe('run_board_header.header_lines beside the stage', () => {
	it('writes how long the run has stood at the stage, then why', () => {
		const board = planned(ONE_PLANNED, standing(STAGE.JUDGING, STAGE_AGE_MS))

		expect(now_of(board)).toBe(JUDGING_LINE)
	})

	it('writes no reason where the plan is not read yet', () => {
		const activity = standing(STAGE.STARTING, STAGE_AGE_MS)

		expect(now_of(header({ activity }))).toBe('⠋  2′31″  🚀 starting session')
	})

	// A chat is no terminal, so it draws no spinner: its place stands blank.
	it('writes the same in the chat form, the spinner’s place blank', () => {
		const board = planned(ONE_PLANNED, standing(STAGE.JUDGING, STAGE_AGE_MS))
		const chat = { ...board, form: 'chat', spinner: undefined } as const

		expect(lines_of(chat)[2]).toBe(`${NOW_INDENT}${JUDGING_LINE.replace(SPINNER, ' ')}`)
	})

	it('writes the hours once the stage has stood for one', () => {
		const hour = 60 * MS_PER_MINUTE
		const board = planned(ONE_PLANNED, standing(STAGE.JUDGING, hour + STAGE_AGE_MS))

		expect(now_of(board)).toBe('⠋  1°02′31″  🤔 waiting on judgment — 1 waiting')
	})
})

describe('run_board_header.header_lines once a child has launched', () => {
	it('writes how many children run on the third line', () => {
		const board = planned(ONE_RUNNING, merged())

		expect(title_of(board)).toMatch(PROGRESS_0_OF_1)
		expect(now_of(board)).toBe(`⠋${' '.repeat(7)}🔄 1 running`)
	})

	it('turns the spinner and writes the stage while a lane opens for a later child', () => {
		const board = planned(NEXT_OPENING, standing(OPENING, SECOND))

		expect(title_of(board)).toMatch(/^▶ backlogrun {2}⏰ 10″ {2}✅ +1\/2 /u)
		expect(now_of(board)).toBe('⠋   1″  🚪 opening lane #278 — 1 waiting')
	})

	it('turns the spinner and writes the stage while a judgment session runs', () => {
		const board = planned(NEXT_OPENING, standing(STAGE.SESSION, 72 * SECOND))

		expect(title_of(board)).toMatch(/^▶ backlogrun /u)
		expect(now_of(board)).toBe('⠋  1′12″  💭 judgment session running — 1 waiting')
	})

	it('stands idle between children, and writes how long it has watched and why', () => {
		const board = planned(NEXT_OPENING, merged(STAGE_AGE_MS))

		expect(title_of(board)).toMatch(/^⏸ backlogrun .*✅ +1\/2 /u)
		expect(now_of(board)).toBe('2′31″  🔭 watching — 1 waiting')
	})
})

describe('run_board_header.header_lines marks a setup does not change', () => {
	it('draws a stopped run as stopped, with the newest thing it did rather than a stage', () => {
		const activity = { ...standing(STAGE.PLANNING), ...merged(SECOND), is_stopped: true }
		const board = planned(ONE_PLANNED, activity)

		expect(title_of(board)).toMatch(/^■ backlogrun .*✅ +0\/1 /u)
		expect(now_of(board)).toBe('1″  🔚 #278 merged')
	})

	it('draws a plan left only to people as waiting on a person', () => {
		const board = planned(PEOPLE, merged(SECOND))

		expect(title_of(board)).toMatch(/^✋ backlogrun/u)
		expect(now_of(board)).toBe('1″  🔭 watching — 1 waiting on a person')
	})

	// joshuafolkken/kit#4099: a child parked on a decision waits on a person as an untouched one does.
	it('draws a plan left to a child parked on a decision as waiting on a person', () => {
		const asked: BoardLayout = { ...PEOPLE, active: [row(1, 'human')] }
		const board = planned(asked, merged(SECOND))

		expect(title_of(board)).toMatch(/^✋ backlogrun/u)
		expect(now_of(board)).toBe('1″  🔭 watching — 2 waiting on a person')
	})

	it('draws a run at a stage as working, though all its plan has left waits on a person', () => {
		const board = planned(PEOPLE, standing(STAGE.SESSION))

		expect(title_of(board)).toMatch(/^▶ backlogrun .*✅ /u)
	})

	it('colors the heartbeat of a setup that has gone quiet, as a running run’s', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		const [, second] = run_board_header.header_lines(
			header({ now_ms: NOW + STALE_MS, activity: standing(STAGE.PLANNING) }),
		)

		expect(second).toContain(styleText('red', '💓 40′00″'))
	})
})
