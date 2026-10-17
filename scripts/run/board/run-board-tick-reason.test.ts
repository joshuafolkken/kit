import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3750: the board draws why each waiting row waits from what it already reads — the
// plan, the run's events and the lanes — on the screen and in the `--chat` frame alike.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const REPO = 'joshuafolkken/kit'
const UNTRIAGED = 3727
const HELD = 3714
const OPENING = 3720
const NO_LANE_LEFT = 0
const OPENED_AT = new Date(START).toISOString()
const OPENING_EVENT = {
	pos: 1,
	at: OPENED_AT,
	kind: 'setup',
	text: run_event_setup.opening_lane(String(OPENING)),
}

function child(number: number, labels: Array<string> = [RUN_LANE_LABEL]): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: [] }
}

function plan_of(children: Array<EpicChild>): BoardPlan {
	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: undefined },
		labels: new Map(),
		declared: new Map(),
	}
}

// The row the board draws for `issue` once the plan is read.
async function row_of(issue: number, local: LocalRead, plan: BoardPlan): Promise<string> {
	const { ports, frames } = harness(local, [plan])

	await tick(FRESH_STATE, ports)

	const lines = stripVTControlCharacters(frames.at(-1) ?? '').split('\n')

	return lines.find((line) => line.includes(` ${String(issue)} `)) ?? ''
}

describe('run_board_tick.tick — why a waiting row waits', () => {
	const POOL = plan_of([child(UNTRIAGED, []), child(HELD)])

	it('draws an untriaged row and the row it holds back, each with its own reason', async () => {
		expect(await row_of(UNTRIAGED, LOCAL, POOL)).toMatch(/ {2}untriaged$/u)
		expect(await row_of(HELD, LOCAL, POOL)).toMatch(/ {2}held by triage$/u)
	})

	it('draws no free lane from the count the local read carries', async () => {
		const full = { ...LOCAL, free_lanes: NO_LANE_LEFT }
		const plan = plan_of([child(HELD)])

		expect(await row_of(HELD, full, plan)).toMatch(/ {2}no free lane$/u)
		expect(await row_of(HELD, LOCAL, plan)).not.toMatch(/lane/u)
	})

	it('draws the stage of the lane the run is opening, and none once the run has stopped', async () => {
		const opening = { ...LOCAL, events: [OPENING_EVENT] }
		const plan = plan_of([child(OPENING)])

		expect(await row_of(OPENING, opening, plan)).toMatch(/ {2}opening lane (?:\d+′)?\d+″$/u)
		expect(await row_of(OPENING, { ...opening, is_stranded: true }, plan)).not.toMatch(/opening/u)
	})
})
