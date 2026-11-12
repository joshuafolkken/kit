import { stripVTControlCharacters } from 'node:util'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const HELD = 6347
const DECIDER = 6459
const REPO = 'joshuafolkken/kit'
const DECIDE_TAIL = `→ decide #${String(DECIDER)}: Approve the Codex PreToolUse hook`

// A withheld child whose decision blocker no longer reads as standing, so no standing wait is left.
function held_plan(): BoardPlan {
	const labels = [RUN_LANE_LABEL]
	const child = {
		number: HELD,
		repo: REPO,
		state: 'OPEN' as const,
		labels,
		blocked_by: [{ repo: REPO, number: DECIDER }],
	}

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map([[HELD, 'held']]), open_numbers: new Set([HELD]) },
		labels: new Map([[HELD, labels]]),
		withheld: new Set([HELD]),
		decision_waits: new Map([[HELD, DECIDE_TAIL]]),
	}
}

describe('run_board_tick human wait on its own row', () => {
	it.each(['screen', 'chat'] as const)(
		'draws the decision tail with no standing wait in %s (ac-98efc942)',
		async (form) => {
			const { ports, frames } = harness(LOCAL, [held_plan()])

			await tick(FRESH_STATE, { ...ports, form })
			const row = stripVTControlCharacters(frames.at(-1) ?? '')
				.split('\n')
				.find((line) => line.includes(String(HELD)))

			expect(row).toContain('🙋')
			expect(row).toContain(DECIDE_TAIL)
		},
	)
})
