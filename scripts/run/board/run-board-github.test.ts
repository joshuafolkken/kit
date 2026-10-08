import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_github, type Gather } from './run-board-github'
import type { BoardPlan } from './run-board-layout'
import { run_board_state, type Pace } from './run-board-state'

const { LOCAL, START, harness, plan_titled } = run_board_fixture
const { gather_github } = run_board_github
const { FRESH_STATE } = run_board_state

// A read that never answers.
async function never(): Promise<BoardPlan | undefined> {
	return await new Promise(() => undefined)
}

function gather_of(plans: Array<BoardPlan | undefined>, pace: Pace): Gather {
	return { ports: harness(LOCAL, plans).ports, local: LOCAL, now_ms: START, pace }
}

describe('run_board_github.gather_github', () => {
	it('waits for the plan and folds it in at the settled pace', async () => {
		const state = await gather_github(FRESH_STATE, gather_of([plan_titled('a')], 'settled'))

		expect(state.plan?.context.titles.get(1)).toBe('a')
		expect(state.fetched_ms).toBe(START)
		expect(state.plan_fetch).toBeUndefined()
	})

	it('launches the plan read and returns without it in the background', async () => {
		const gather = gather_of([], 'background')
		const state = await gather_github(FRESH_STATE, {
			...gather,
			ports: { ...gather.ports, read_plan: never },
		})

		expect(state.plan).toBeUndefined()
		expect(state.plan_fetch?.answer()).toBeUndefined()
		expect(state.attempted_ms).toBe(START)
	})

	it('records when a failed plan read was asked', async () => {
		const state = await gather_github(FRESH_STATE, gather_of([undefined], 'settled'))

		expect(state.plan).toBeUndefined()
		expect(state.failed_ms).toBe(START)
	})

	it('does not launch a second plan read while one is in flight', async () => {
		const gather = gather_of([], 'background')
		const ports = { ...gather.ports, read_plan: never }
		const first = await gather_github(FRESH_STATE, { ...gather, ports })
		const second = await gather_github(first, { ...gather, ports })

		expect(second.plan_fetch).toBe(first.plan_fetch)
	})
})
