import { stripVTControlCharacters } from 'node:util'
import { NEEDS_DECISION_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const HELD = 6347
const DECIDER = 6459
const REPO = 'joshuafolkken/kit'
const DECIDER_TITLE = 'Approve the Codex PreToolUse hook'
const DECIDE_TAIL = `→ decide (hook) (blocks #${String(HELD)})`

function line_of(frame: string, text: string): string | undefined {
	return stripVTControlCharacters(frame)
		.split('\n')
		.find((line) => line.includes(text))
}

// A withheld child held by a decision blocker outside the run (joshuafolkken/kit#8026).
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
		decision_blockers: [
			{
				number: DECIDER,
				title: DECIDER_TITLE,
				labels: [NEEDS_DECISION_LABEL],
				need: 'decide',
				detail: 'hook',
				blocks: [HELD],
			},
		],
	}
}

describe('run_board_tick human wait on its blocker row', () => {
	it.each(['screen', 'chat'] as const)(
		'draws the blocker with its action and the held row plain in %s (ac-98efc942)',
		async (form) => {
			const { ports, frames } = harness(LOCAL, [held_plan()])

			await tick(FRESH_STATE, { ...ports, form })
			const frame = frames.at(-1) ?? ''

			expect(line_of(frame, DECIDER_TITLE)).toContain('🙋')
			expect(line_of(frame, DECIDER_TITLE)).toContain(DECIDE_TAIL)
			expect(line_of(frame, ' held')).not.toContain('🙋')
		},
	)
})
