import { describe, expect, it, vi } from 'vitest'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_closed_pace } from './run-board-closed-pace'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { LocalRead } from './run-board-read'
import { run_board_state, type BoardState } from './run-board-state'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#7557: a going run's child that merged itself and left its lane stayed drawn 🛑 a
// whole retry interval when the first closed read landed before GitHub showed the merge. A child whose
// lane just ended is asked about again sooner, within a window.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { gather_github, open_read_of, statuses_for } = run_board_github
const { FRESH_END_WINDOW_MS, FRESH_RETRY_MS } = run_board_closed_pace
const { FRESH_STATE } = run_board_state
const CHILD = 7539
const STOPPED_CHILD = {
	state: 'stopped' as const,
	lane: `lane ${String(CHILD)}`,
	started_ms: START - 1,
}
const READ_STATE: BoardState = {
	...FRESH_STATE,
	plan: plan_titled('a'),
	attempted_ms: START,
	fetched_ms: START,
}
const NOT_YET: ClosedAnswer = { closed: new Map(), is_whole: true }
const MERGED: ClosedAnswer = {
	closed: new Map([
		[CHILD, { title: 'a', labels: [], closed_ms: START, is_merged: true, is_not_planned: false }],
	]),
	is_whole: true,
}

function local_ended_at(lane_ended_ms: number): LocalRead {
	return {
		...LOCAL,
		lanes: [String(CHILD)],
		lane_states: {
			own: new Map([[CHILD, STOPPED_CHILD]]),
			earlier: new Map(),
			unknown: [],
			ended: new Map([[CHILD, { ended_ms: lane_ended_ms, by: 'lane:close' }]]),
		},
	}
}

function gather_at(local: LocalRead, now_ms: number): Gather {
	const { ports } = harness(local, [plan_titled('a')])

	vi.mocked(ports.read_closed).mockResolvedValueOnce(NOT_YET).mockResolvedValueOnce(MERGED)

	return { ports, local, now_ms, pace: 'settled' }
}

function drawn_state(state: BoardState, local: LocalRead): string | undefined {
	const read = open_read_of(state, state.plan)

	return run_board_status.settle_closed(statuses_for(state, local), read).get(CHILD)?.state
}

async function ask_twice(local: LocalRead): Promise<{ state: BoardState; gather: Gather }> {
	const gather = gather_at(local, START + 1)
	const first = await gather_github(READ_STATE, gather)
	const state = await gather_github(first, { ...gather, now_ms: START + 1 + FRESH_RETRY_MS })

	return { state, gather }
}

describe('run_board_github.gather_github — a going run child whose lane just ended', () => {
	it('asks again after the short interval and draws it merged', async () => {
		const local = local_ended_at(START)
		const { state, gather } = await ask_twice(local)

		expect(gather.ports.read_closed).toHaveBeenCalledTimes(2)
		expect(drawn_state(state, local)).toBe('merged')
	})

	it('waits the usual interval once its lane ended past the window', async () => {
		const local = local_ended_at(START - FRESH_END_WINDOW_MS)
		const { state, gather } = await ask_twice(local)

		expect(gather.ports.read_closed).toHaveBeenCalledOnce()
		expect(drawn_state(state, local)).toBe('stopped')
	})
})
