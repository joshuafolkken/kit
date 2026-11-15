import { describe, expect, it, vi } from 'vitest'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_closed_pace } from './run-board-closed-pace'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { LocalRead } from './run-board-read'
import { run_board_state, type BoardState } from './run-board-state'
import { run_board_status } from './run-board-status'

// joshuafolkken/kit#7556: an ended run whose first whole answer came before a stopped child's merge
// showed kept the child drawn 🛑 though it had merged. A stopped child is asked about again until the
// limit after the end.

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { PLAN_RETRY_MS, gather_github, open_read_of, statuses_for } = run_board_github
const { STOPPED_ASK_LIMIT_MS } = run_board_closed_pace
const { FRESH_STATE } = run_board_state
const CHILD = 7539
const STOPPED_CHILD = {
	state: 'stopped' as const,
	lane: `lane ${String(CHILD)}`,
	started_ms: START - 1,
}
const LOCAL_ENDED: LocalRead = {
	...LOCAL,
	ended_ms: START,
	lanes: [String(CHILD)],
	lane_states: { own: new Map([[CHILD, STOPPED_CHILD]]), earlier: new Map(), unknown: [] },
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

function gather_at(now_ms: number): Gather {
	const { ports } = harness(LOCAL_ENDED, [plan_titled('a')])

	vi.mocked(ports.read_closed).mockResolvedValueOnce(NOT_YET).mockResolvedValueOnce(MERGED)

	return { ports, local: LOCAL_ENDED, now_ms, pace: 'settled' }
}

function drawn_state(state: BoardState): string | undefined {
	const read = open_read_of(state, state.plan)

	return run_board_status.settle_closed(statuses_for(state, LOCAL_ENDED), read).get(CHILD)?.state
}

async function ask_twice(second_ms: number): Promise<{ state: BoardState; gather: Gather }> {
	const gather = gather_at(START + 1)
	const first = await gather_github(READ_STATE, gather)
	const state = await gather_github(first, { ...gather, now_ms: second_ms })

	return { state, gather }
}

describe('run_board_github.gather_github — a stopped child of an ended run', () => {
	it('draws it merged when an ask after the first whole answer says it merged', async () => {
		const { state } = await ask_twice(START + 1 + PLAN_RETRY_MS)

		expect(drawn_state(state)).toBe('merged')
	})

	it('stops asking about it past the limit after the end', async () => {
		const { state, gather } = await ask_twice(START + STOPPED_ASK_LIMIT_MS + 1)

		expect(gather.ports.read_closed).toHaveBeenCalledOnce()
		expect(drawn_state(state)).toBe('stopped')
	})
})
