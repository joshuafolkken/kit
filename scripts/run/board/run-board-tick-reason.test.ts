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
const HOUR_MS = 3_600_000
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
		String.raw`^ {5}\S+ .{${String(CONDITION_WIDTH)}} ${String(issue)}(?: |$)`,
		'u',
	)

	return lines.find((line) => locator.test(line)) ?? ''
}

describe('run_board_tick.tick — why a waiting row waits', () => {
	const POOL = plan_of([child(UNTRIAGED, []), child(HELD)])

	// joshuafolkken/kit#5518: the untriaged row holds only itself.
	it('draws ✋ on the untriaged row alone, the judged row beside it held by nothing', async () => {
		expect(await row_of(UNTRIAGED, LOCAL, POOL)).toMatch(/^ {5}✋ {13}3727$/u)
		expect(await row_of(HELD, LOCAL, POOL)).not.toMatch(/✋/u)
	})

	it('draws next free lane from the count the local read carries', async () => {
		const full = { ...LOCAL, free_lanes: NO_LANE_LEFT }
		const plan = plan_of([child(HELD)])

		expect(await row_of(HELD, full, plan)).toMatch(/^ {5}🧵 {13}3714$/u)
		expect(await row_of(HELD, LOCAL, plan)).not.toMatch(/🧵/u)
	})

	// joshuafolkken/kit#8953: named issues run side by side, so a named row waits on no earlier one.
	it('draws no declared-order mark on a named row behind a running one', async () => {
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

		expect(await row_of(HELD, named, plan)).not.toMatch(/📋/u)
	})

	it('draws the stage of the lane the run is opening, and none once the run has stopped', async () => {
		const opening = { ...LOCAL, events: [OPENING_EVENT] }
		const plan = plan_of([child(OPENING)])

		expect(await row_of(OPENING, opening, plan)).toMatch(/^ {5}🚪 (?:\d+′)?\d+″ +3720$/u)
		expect(await row_of(OPENING, { ...opening, is_stranded: true }, plan)).not.toMatch(/🚪/u)
	})
})

// joshuafolkken/kit#4796: the usage-limit reset the local read carries reaches the waiting row.
describe('run_board_tick.tick — a usage-limit hold', () => {
	it('draws the usage-limit reset the local read carries', async () => {
		const held = { ...LOCAL, usage_reset_ms: START + HOUR_MS }
		const plan = plan_of([child(HELD)])

		expect(await row_of(HELD, held, plan)).toMatch(/^ {5}🪫 \d{2}-\d{2} \d{2}:\d{2} +3714$/u)
		expect(await row_of(HELD, LOCAL, plan)).not.toMatch(/🪫/u)
	})

	// joshuafolkken/kit#8015: the hold's cause reaches the row, so an authentication failure is not 🪫.
	it('draws the authentication-failure mark where the hold the local read carries is one', async () => {
		const held = { ...LOCAL, usage_reset_ms: START + HOUR_MS, usage_cause: 'auth' as const }
		const row = await row_of(HELD, held, plan_of([child(HELD)]))

		expect(row).toMatch(/^ {5}🔑 \d{2}-\d{2} \d{2}:\d{2} +3714$/u)
		expect(row).not.toMatch(/🪫/u)
	})
})
