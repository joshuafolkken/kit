import type { BudgetWait } from '#scripts/gate/core-wait'
import { describe, expect, it, vi } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3943: the claims waiting in the core budget are read on the machine's second and
// drawn — one no running row owns before the legend (joshuafolkken/kit#4052).

const { LOCAL, harness, plan_titled } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const WAITS: Array<BudgetWait> = [
	{ command: 'gate lint', lane: '3943', elsewhere: undefined, waited_ms: 5000, reason: 'pressure' },
]

describe('run_board_tick.tick budget waits', () => {
	it('reads the waiting claims with the machine sample and draws them', async () => {
		const { ports, frames } = harness(LOCAL, [plan_titled('a')])
		const read_waits = vi.fn(() => WAITS)

		const state = await tick(FRESH_STATE, { ...ports, read_waits })

		expect(read_waits).toHaveBeenCalledOnce()
		expect(state.budget_waits).toStrictEqual(WAITS)
		expect(frames.join('\n')).toContain('  🚧 🧠 5″ lint 3943')
	})

	it('reads no waiting claim where the board is given no reader', async () => {
		const { ports } = harness(LOCAL, [plan_titled('a')])

		const state = await tick(FRESH_STATE, ports)

		expect(state.budget_waits).toStrictEqual([])
	})
})
