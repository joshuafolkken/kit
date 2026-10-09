import { stripVTControlCharacters } from 'node:util'
import { backlog_idle } from '#scripts/backlog/backlog-idle'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3486: the header is three lines and a blank in every state, the run's own children
// are drawn before the plan is read, a run with a child running never reads as waiting, and a live frame
// is kept within its terminal.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, tick } = run_board_tick
const MINUTE = 60_000
const CHILD = 3421
const LAUNCH = {
	pos: 1,
	at: '2026-10-08T09:00:00.000Z',
	kind: 'child-launch',
	text: `#${String(CHILD)} a`,
}
const WINDOW = {
	since_ms: START,
	until_ms: START + 20 * MINUTE,
	bound: 'idle' as const,
	asked_ms: START,
}
const IDLE = { pos: 2, at: LAUNCH.at, kind: 'idle', text: backlog_idle.text_of(WINDOW) }
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
	it('draws two header lines and a blank, the run’s own child, and - for what it does not know', async () => {
		const lines = await loading([LAUNCH])

		expect(lines[0]).toMatch(/ {2}✅ 0\/- ─+ {2}🔄 1 {2}⏳ - {2}💤 0/u)
		expect(lines[1]).toContain('🧠')
		expect(lines[2]).toBe('')
		expect(lines[3]).toMatch(new RegExp(`^. 🔍 ${String(CHILD)}    …`, 'u'))
	})

	// The regression: the running count was the plan's, so a board still loading drew a run as waiting.
	it('draws no wait line and no ⏸ while a child runs, though the stream says the run waits', async () => {
		const lines = await loading([LAUNCH, IDLE])

		expect(lines[0]).not.toMatch(/^⏸/u)
		expect(lines.join('\n')).not.toContain('wait ends')
	})

	it('draws the wait under the blank when no child runs', async () => {
		const lines = await loading([{ ...IDLE, pos: 1 }])

		expect(lines[0]).toMatch(/^⏸ backlogrun/u)
		expect(lines.slice(2, 4)).toStrictEqual(['', expect.stringMatching(/^ {2}⏸ wait ends /u)])
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
