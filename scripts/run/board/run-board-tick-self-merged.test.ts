import { stripVTControlCharacters } from 'node:util'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedAnswer, ClosedIssue } from './run-board-closed'
import { run_board_fixture, type Harness } from './run-board-fixture'
import { run_board_gather } from './run-board-gather'
import { run_board_lane_state, type BoardLanes } from './run-board-lane-state'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_status } from './run-board-status'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#4401: a lane child that merged itself and left its lane was drawn 🛑 until the
// parent's `run:merge` wrote the merge or the open listing was read again without it, since only a
// child the listing no longer held was read closed. A child the board draws stopped is now read closed
// at once, the listing still holding it or not.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const { LOCAL_READ_MS } = run_board_gather
const IDLE_CHILD = 4370
const UNLABELLED_CHILD = 4371
const AT = new Date(START).toISOString()
const IN_PROGRESS = ['in-progress']

function launch(issue: number, pos: number): RunEvent {
	return { pos, at: AT, kind: 'child-launch', text: `#${String(issue)} a` }
}

const IDLE_LAUNCH = launch(IDLE_CHILD, 1)
const UNLABELLED_LAUNCH = launch(UNLABELLED_CHILD, 2)
// This run's lane, as its record and its launch draw it.
const OWN: BoardLanes = {
	...run_board_lane_state.NO_LANES,
	own: new Map([
		[
			IDLE_CHILD,
			{ ...run_board_status.fold_events([IDLE_LAUNCH]).get(IDLE_CHILD), state: 'running' },
		],
	]),
}
const IDLE: LocalRead = {
	...LOCAL,
	events: [IDLE_LAUNCH],
	lanes: [String(IDLE_CHILD)],
	lane_states: OWN,
	idle_lanes: [String(IDLE_CHILD)],
}
// The idle lane's child and a second one whose `in-progress` the listing no longer carries.
const BOTH: LocalRead = { ...IDLE, events: [IDLE_LAUNCH, UNLABELLED_LAUNCH] }
const WORKING: LocalRead = { ...BOTH, idle_lanes: [] }

// A listing read whole that still holds both children open — the idle one still `in-progress`.
function listing(idle_labels: ReadonlyArray<string>): BoardPlan {
	return {
		waves: { waves: [], unreached: [] },
		tracked: new Map(),
		context: {
			repo: 'joshuafolkken/kit',
			titles: new Map(),
			open_numbers: new Set([IDLE_CHILD, UNLABELLED_CHILD]),
		},
		labels: new Map([
			[IDLE_CHILD, idle_labels],
			[UNLABELLED_CHILD, []],
		]),
	}
}

function merged_at(closed_ms: number): ClosedIssue {
	return { title: 'a', labels: [], closed_ms, is_merged: true, is_not_planned: false }
}

function merged(issues: ReadonlyArray<number>): ClosedAnswer {
	const closed = new Map(issues.map((issue) => [issue, merged_at(START)]))

	return { closed, is_whole: true }
}

function row_of(frames: ReadonlyArray<string>, issue: number): string | undefined {
	const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

	return lines.find((line) => line.includes(String(issue)))
}

// A single frame that waits out the idle window on a clock it moves.
function single_frame(local: LocalRead, plan: BoardPlan): Harness {
	const board = harness(local, [plan])

	board.gathering.sleep = async (ms) => {
		board.clock.now_ms += ms
	}

	return board
}

describe('run_board_tick.tick — a child that merged itself while the listing still held it', () => {
	it('reads an idle lane’s child closed and draws its merge', async () => {
		const { ports, frames, read_closed } = single_frame(IDLE, listing(IN_PROGRESS))

		read_closed.mockImplementation(async (issues) => merged(issues))
		await tick(FRESH_STATE, ports)

		expect(read_closed).toHaveBeenCalledWith([IDLE_CHILD])
		expect(row_of(frames, IDLE_CHILD)).toContain('✅')
		expect(row_of(frames, IDLE_CHILD)).not.toContain('🛑')
	})

	it('reads a child whose `in-progress` was dropped closed and draws its merge', async () => {
		const { ports, frames, read_closed } = single_frame(WORKING, listing(IN_PROGRESS))

		read_closed.mockImplementation(async (issues) => merged(issues))
		await tick(FRESH_STATE, ports)

		expect(read_closed).toHaveBeenCalledWith([UNLABELLED_CHILD])
		expect(row_of(frames, UNLABELLED_CHILD)).toContain('✅')
	})

	it('reads an idle lane’s child closed again when its kept close predates its launch', async () => {
		const { ports, frames, read_closed } = single_frame(IDLE, listing(IN_PROGRESS))
		const kept = new Map([[IDLE_CHILD, merged_at(START - 1)]])

		read_closed.mockImplementation(async (issues) => merged(issues))
		await tick({ ...FRESH_STATE, run_started_ms: START, closed: kept }, ports)

		expect(read_closed).toHaveBeenCalledWith([IDLE_CHILD])
		expect(row_of(frames, IDLE_CHILD)).toContain('✅')
	})

	it('keeps an idle lane whose child never merged stopped', async () => {
		const { ports, frames, read_closed } = single_frame(IDLE, listing(IN_PROGRESS))

		await tick(FRESH_STATE, ports)

		expect(read_closed).toHaveBeenCalledWith([IDLE_CHILD])
		expect(row_of(frames, IDLE_CHILD)).toContain('🛑')
	})
})

describe('run_board_tick.tick — when a stopped child is asked about again', () => {
	it('waits out the interval for the same children and asks at once when one joins', async () => {
		const { ports, read_closed, read_local, clock } = single_frame(IDLE, listing(IN_PROGRESS))
		const first = await tick(FRESH_STATE, ports)

		clock.now_ms += LOCAL_READ_MS
		const second = await tick(first, ports)

		expect(read_closed).toHaveBeenCalledOnce()

		read_local.mockResolvedValue(BOTH)
		clock.now_ms += LOCAL_READ_MS
		await tick(second, ports)

		expect(read_closed).toHaveBeenLastCalledWith([IDLE_CHILD, UNLABELLED_CHILD])
	})
})
