import { stripVTControlCharacters, styleText } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { RunActivity } from './run-board-status'

// joshuafolkken/kit#3696: the header between `josh backlogrun` and the first child — the mark turns, and
// the run's stage stands where its progress will. From the first launch on the progress is back, and a
// lane opening for a later child only turns the mark.

const SECOND = 1000
const STARTED = Date.parse('2026-10-12T09:00:00.000Z')
const NOW = STARTED + 10 * SECOND
const SPINNER = '⠋'
const { STAGE } = run_event_setup
const OPENING = run_event_setup.opening_lane('278')
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }
const STALE_MS = 40 * backlog_budget.MS_PER_MINUTE

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

const ONE_PLANNED: BoardLayout = { ...EMPTY_LAYOUT, active: [row(278, 'waiting')] }
const ONE_RUNNING: BoardLayout = { ...EMPTY_LAYOUT, active: [row(278, 'running')] }
const NEXT_OPENING: BoardLayout = {
	...EMPTY_LAYOUT,
	active: [row(278, 'merged'), row(279, 'waiting')],
}

// The run at a stage before its first launch; `undefined` once a child has launched and a lane opens.
function preparing(setup: string | undefined, age_ms = 0): RunActivity {
	return { setup, is_preparing: true, last_event_ms: NOW - age_ms, is_stopped: false }
}

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: preparing(STAGE.STARTING),
		layout: undefined,
		baseline_total: undefined,
		plan_fetched_ms: undefined,
		plan_failed_ms: undefined,
		is_plan_loading: false,
		machine: undefined,
		spinner: SPINNER,
		form: 'screen',
		repo: 'joshuafolkken/app-kit',
		link: (reference) => reference,
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

// The first line of a header whose plan has been read.
function planned_title(layout: BoardLayout, activity: RunActivity): string {
	return title_of(planned(layout, activity))
}

// The run past its first launch, with no lane opening.
const LAUNCHED: RunActivity = {
	last_event_ms: NOW,
	is_stopped: false,
	setup: undefined,
	is_preparing: false,
}

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_header.header_lines before the first child launches', () => {
	it('turns the spinner and writes the stage where the progress will stand', () => {
		const [first, second] = lines_of(header())

		expect(first).toBe('⠋ backlogrun  ⏰ 0:00:10  starting session')
		expect(second).toMatch(/^ {2}app-kit {5}💓 /u)
	})

	it('draws the still mark of a working run where the frame has no spinner', () => {
		expect(title_of(header({ spinner: undefined }))).toMatch(/^▶ backlogrun .* starting session$/u)
	})

	it('follows the stage with how many issues are planned once the plan is read', () => {
		const handing_off = planned_title(ONE_PLANNED, preparing(STAGE.HANDING_OFF))
		const opening = planned_title(ONE_PLANNED, preparing(OPENING))

		expect(handing_off).toMatch(/ {2}handing off · 1 planned$/u)
		expect(planned_title(ONE_PLANNED, preparing(STAGE.JUDGING))).toMatch(
			/ {2}waiting on judgment · 1 planned$/u,
		)
		expect(opening).toMatch(/^⠋ backlogrun .* opening lane #278 · 1 planned$/u)
	})

	it('keeps the machine line where it is whatever the stage’s length', () => {
		const short = lines_of(header({ activity: preparing(STAGE.PLANNING) }))
		const long = lines_of(planned(ONE_PLANNED, preparing(OPENING)))

		expect(short[0]).not.toBe(long[0])
		expect(long[1]).toBe(short[1])
	})

	it('says a plan read failed after the stage', () => {
		expect(title_of(header({ plan_failed_ms: NOW }))).toMatch(/starting session {2}⚠ /u)
	})
})

describe('run_board_header.header_lines once a child has launched', () => {
	it('draws the progress again from the first launch', () => {
		const first = planned_title(ONE_RUNNING, LAUNCHED)

		expect(first).toMatch(/^⠋ backlogrun {2}⏰ 0:00:10 {2}✅ +0\/1 /u)
		expect(first).not.toContain('planned')
	})

	it('keeps the progress and turns the spinner while a lane opens for a later child', () => {
		const first = planned_title(NEXT_OPENING, preparing(undefined))

		expect(first).toMatch(/^⠋ backlogrun {2}⏰ 0:00:10 {2}✅ +1\/2 /u)
	})

	it('stands idle between children with no lane opening', () => {
		expect(planned_title(NEXT_OPENING, LAUNCHED)).toMatch(/^⏸ backlogrun .*✅ +1\/2 /u)
	})
})

describe('run_board_header.header_lines marks a setup does not change', () => {
	it('draws a stopped run as stopped, with its progress rather than a stage', () => {
		const activity = { ...preparing(STAGE.PLANNING), is_stopped: true }
		const first = planned_title(ONE_PLANNED, activity)

		expect(first).toMatch(/^■ backlogrun .*✅ +0\/1 /u)
		expect(first).not.toContain(STAGE.PLANNING)
	})

	it('draws a plan left only to people as waiting on a person', () => {
		const people = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		const first = planned_title(people, preparing(undefined))

		expect(first).toMatch(/^✋ backlogrun/u)
	})

	it('keeps the progress of a run waiting on a person whose start reached no launch', () => {
		const people = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }

		const first = planned_title(people, preparing(STAGE.HANDING_OFF))

		expect(first).toMatch(/^✋ backlogrun .*✅ /u)
		expect(first).not.toContain(STAGE.HANDING_OFF)
	})

	it('colors the heartbeat of a setup that has gone quiet, as a running run’s', () => {
		vi.stubEnv('FORCE_COLOR', '1')

		const [, second] = run_board_header.header_lines(
			header({ now_ms: NOW + STALE_MS, activity: preparing(STAGE.PLANNING) }),
		)

		expect(second).toContain(styleText('red', '💓 0:40:00'))
	})
})
