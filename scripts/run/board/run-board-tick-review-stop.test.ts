import { stripVTControlCharacters } from 'node:util'
import { NEEDS_HUMAN_REVIEW_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#8527: the stopped lanes the local read found reach the plan the board lays out, so
// a child held at a review stop is drawn as a person's row naming its lane.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const HELD = 5272
const REPO = 'joshuafolkken/kit'
const TITLE = 'Held for review'
const DIRECTORY = '/work/.kit-lanes/5272'

function stopped_plan(): BoardPlan {
	const labels = [NEEDS_HUMAN_REVIEW_LABEL]
	const child = { number: HELD, repo: REPO, state: 'OPEN' as const, labels, blocked_by: [] }

	return {
		waves: { waves: [[child]], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map([[HELD, TITLE]]), open_numbers: new Set([HELD]) },
		labels: new Map([[HELD, labels]]),
	}
}

describe('run_board_tick — review stops', () => {
	it('lays out the local read’s stopped lanes, drawing the held child as a person’s row', async () => {
		const stop = { stopped_ms: START, directory: DIRECTORY }
		const local: LocalRead = { ...LOCAL, review_stops: new Map([[HELD, stop]]) }
		const { ports, frames } = harness(local, [stopped_plan()])

		await tick(FRESH_STATE, { ...ports, form: 'chat' })
		const frame = stripVTControlCharacters(frames.at(-1) ?? '')
		const row = frame.split('\n').find((line) => line.includes(TITLE))

		expect(row).toContain('🙋')
		expect(row).toContain(`→ review the uncommitted changes in ${DIRECTORY}`)
	})
})
