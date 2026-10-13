import { stripVTControlCharacters } from 'node:util'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3486: the header is three lines and a blank in every state, the run's own children
// are drawn before the plan is read, a run with a child running never reads as waiting, and a live frame
// is kept within its terminal.

const { LOCAL, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const CHILD = 3421
const LAUNCH = {
	pos: 1,
	at: '2026-10-08T09:00:00.000Z',
	kind: 'child-launch',
	text: `#${String(CHILD)} a`,
}
const DRAIN = { pos: 2, at: LAUNCH.at, kind: 'drain', text: 'backlog drained' }
const REPO = 'joshuafolkken/kit'
const SHORT = { rows: 15, columns: 80 }

// A read that never answers, as a plan read still in flight.
async function never(): Promise<never> {
	return await new Promise(() => undefined)
}

function lines_of(frame = ''): Array<string> {
	return stripVTControlCharacters(frame).trimEnd().split('\n')
}

// A plan of `count` issues none of which has started.
function long_plan(count: number): BoardPlan {
	const children: Array<EpicChild> = Array.from({ length: count }, (_, index) => ({
		number: index + 1,
		repo: REPO,
		state: 'OPEN',
		labels: [],
		blocked_by: [],
	}))

	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: undefined },
		labels: new Map(),
	}
}

// The frame a live board draws before its plan read has answered.
async function loading(events: ReadonlyArray<typeof LAUNCH>): Promise<Array<string>> {
	const { ports, frames } = harness({ ...LOCAL, events }, [])

	await tick(FRESH_STATE, { ...ports, read_plan: never }, 'background')

	return lines_of(frames[0])
}

describe('run_board_tick.tick before the plan is read', () => {
	it('draws three header lines and a blank, the run’s own child, and - for what it does not know', async () => {
		const lines = await loading([LAUNCH])

		expect(lines[0]).toMatch(/ {2}✅ {2}0\/- ─+ {2}🔄 1 {2}⏳ - {2}💤 0/u)
		expect(lines[1]).toContain('🧠')
		expect(lines[2]).toMatch(/^ +1 running$/u)
		expect(lines[3]).toBe('')
		expect(lines[4]).toMatch(new RegExp(`^. 🔍 ${String(CHILD)}    …`, 'u'))
	})

	// The regression: the running count was the plan's, so a board still loading drew a run as waiting.
	it('draws no ⏸ while a child runs, though the stream says the backlog drained', async () => {
		const lines = await loading([LAUNCH, DRAIN])

		expect(lines[0]).not.toMatch(/^⏸/u)
	})

	// joshuafolkken/kit#3689: a waiting run's second line is a working run's — the heartbeat, then the
	// machine. joshuafolkken/kit#3692: no plan is read yet, so no repository is named before them.
	it('marks the run ⏸ and draws no wait on the second line when no child runs', async () => {
		const lines = await loading([{ ...DRAIN, pos: 1 }])

		expect(lines[0]).toMatch(/^⏸ backlogrun {2}⏰ \d+:\d{2}:\d{2} {2}✅/u)
		expect(lines[1]).toMatch(/^ +💓 \d+:\d{2}:\d{2} {2}🧠/u)
		expect(lines[2]).toMatch(/^ +watching \d+:\d{2}/u)
		expect(lines.slice(1).join('\n')).not.toMatch(/[⏸⌛]/u)
	})

	// joshuafolkken/kit#3697: a run whose driver and supervisor are gone was drawn as still waiting.
	it('marks a run nobody is driving ■, not ⏸', async () => {
		const stranded = { ...LOCAL, events: [{ ...DRAIN, pos: 1 }], is_stranded: true }
		const { ports, frames } = harness(stranded, [])

		await tick(FRESH_STATE, { ...ports, read_plan: never }, 'background')

		expect(lines_of(frames[0])[0]).toMatch(/^■ backlogrun/u)
	})
})

// The regression: a plan taller than the pane pushed the header off the top of the screen.
describe('run_board_tick.tick in a short terminal', () => {
	it('starts the frame with the title line and keeps it within the rows once the plan is read', async () => {
		const { ports, frames } = harness(LOCAL, [long_plan(30)])

		await tick(FRESH_STATE, { ...ports, size: () => SHORT })

		const lines = lines_of(frames[0])
		const rows = lines.reduce((sum, line) => sum + run_board_fit.height_of(line, SHORT.columns), 0)

		expect(lines[0]).toMatch(/backlogrun/u)
		expect(rows).toBeLessThanOrEqual(SHORT.rows)
		expect(lines).toContainEqual(expect.stringMatching(/^ {2}more \d+$/u))
	})
})

// joshuafolkken/kit#3531: the findings name a parked child by the plan's title once the plan is read.
describe('run_board_tick.tick park titles', () => {
	const PARK = { pos: 1, at: LAUNCH.at, kind: 'park', text: '#1 waiting on #7' }

	it('draws the reason alone before the plan is read', async () => {
		const lines = await loading([PARK])

		expect(lines).toContainEqual(expect.stringMatching(/ 1 {2}waiting on #7$/u))
	})

	it('names the parked child by the plan’s title once the plan is read', async () => {
		const { ports, frames } = harness({ ...LOCAL, events: [PARK] }, [
			run_board_fixture.plan_titled('Lead the lanes'),
		])

		await tick(FRESH_STATE, ports)

		expect(lines_of(frames.at(-1))).toContainEqual(
			expect.stringMatching(/ 1 {2}Lead the lanes \(waiting on #7\)$/u),
		)
	})
})
