import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { describe, expect, it } from 'vitest'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3750: the board draws why each waiting row waits from what it already reads — the
// plan, the run's events and the lanes — on the screen and in the `--chat` frame alike.
// joshuafolkken/kit#4288: a waiting row draws its wait icon, its condition column, then its number.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const REPO = 'joshuafolkken/kit'
const UNTRIAGED = 3727
const HELD = 3714
const OPENING = 3720
const NO_LANE_LEFT = 0
const { CONDITION_WIDTH } = run_board_render_condition
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

	// Another row's condition column can name the issue, and a line with no title ends at its number.
	const locator = new RegExp(
		String.raw`^ {4}\S+ .{${String(CONDITION_WIDTH)}} ${String(issue)}(?: |$)`,
		'u',
	)

	return lines.find((line) => locator.test(line)) ?? ''
}

describe('run_board_tick.tick — why a waiting row waits', () => {
	const POOL = plan_of([child(UNTRIAGED, []), child(HELD)])

	it('draws an untriaged row and the row it holds back, each with its own reason', async () => {
		expect(await row_of(UNTRIAGED, LOCAL, POOL)).toMatch(/^ {4}❓ {13}3727$/u)
		expect(await row_of(HELD, LOCAL, POOL)).toMatch(/^ {4}✋ 3727 {8}3714$/u)
	})

	it('draws next free lane from the count the local read carries', async () => {
		const full = { ...LOCAL, free_lanes: NO_LANE_LEFT }
		const plan = plan_of([child(HELD)])

		expect(await row_of(HELD, full, plan)).toMatch(/^ {4}🧵 {13}3714$/u)
		expect(await row_of(HELD, LOCAL, plan)).not.toMatch(/🧵/u)
	})

	// joshuafolkken/kit#4206: the declared order is read off the local read's own record.
	it('draws the declared issue a named run starts a row after', async () => {
		const carry = {
			invocation: `backlogrun #${String(OPENING)} #${String(HELD)} --only`,
			started_at: OPENED_AT,
			merged: 0,
			filed: 0,
			cuts: 0,
			failures: 0,
			outages: 0,
		}
		const named = { ...LOCAL, lanes: [String(OPENING)], carry }
		const plan = plan_of([child(OPENING), child(HELD)])

		expect(await row_of(HELD, named, plan)).toMatch(/^ {4}📋 3720 {8}3714$/u)
		expect(await row_of(HELD, LOCAL, plan)).not.toMatch(/📋/u)
	})

	it('draws the stage of the lane the run is opening, and none once the run has stopped', async () => {
		const opening = { ...LOCAL, events: [OPENING_EVENT] }
		const plan = plan_of([child(OPENING)])

		expect(await row_of(OPENING, opening, plan)).toMatch(/^ {4}🚪 (?:\d+′)?\d+″ +3720$/u)
		expect(await row_of(OPENING, { ...opening, is_stranded: true }, plan)).not.toMatch(/🚪/u)
	})
})
