import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3451: a board opened after a run's children closed drew them from the stream alone —
// three `child-launch` events and nothing else — as `🏁 3439` with no title and no time. A child the
// open listing no longer holds is read closed from GitHub once, then drawn with its title, its time and
// whether it merged.

const { LOCAL, START, harness } = run_board_fixture
const { FRESH_STATE, PLAN_RETRY_MS, tick } = run_board_tick
const CHILDREN = [3439, 3444, 3446]
const LAUNCHED_AT = '2026-10-08T08:00:00.000Z'
// 45 minutes 48 seconds after the launch.
const CLOSED_MS = Date.parse('2026-10-08T08:45:48.000Z')

function launch(issue: number, pos: number): RunEvent {
	return { pos, at: LAUNCHED_AT, kind: 'child-launch', text: `#${String(issue)} launched` }
}

const LOCAL_CLOSED = { ...LOCAL, events: CHILDREN.map((issue, index) => launch(issue, index + 1)) }
// A listing read whole, holding none of the children.
const PLAN: BoardPlan = {
	waves: { waves: [], unreached: [] },
	tracked: new Map(),
	context: { repo: 'joshuafolkken/kit', titles: new Map(), open_numbers: new Set() },
	labels: new Map(),
}

function merged_closed(
	issues: ReadonlyArray<number>,
	labels: ReadonlyArray<string> = [],
): ClosedAnswer {
	const closed = new Map(
		issues.map((issue) => [
			issue,
			{ title: `Child ${String(issue)}`, labels, closed_ms: CLOSED_MS, is_merged: true },
		]),
	)

	return { closed, is_whole: true }
}

// An ask that hit a rate limit or a network failure: nothing answered.
const FAILED: ClosedAnswer = { closed: new Map(), is_whole: false }

function row_of(frame: string | undefined, issue: number): string | undefined {
	return frame?.split('\n').find((line) => line.includes(String(issue)))
}

describe('run_board_tick.tick — children that closed', () => {
	// joshuafolkken/kit#3535: its track is kept, ended on its state icon.
	it('draws a closed child nameless and timeless while GitHub has not answered', async () => {
		const { ports, frames } = harness(LOCAL_CLOSED, [PLAN])

		await tick(FRESH_STATE, ports)

		expect(row_of(frames.at(-1), 3439)?.trim()).toBe('🏁 3439     🔍🏁')
	})

	it('draws each child read closed with its title, time and merge', async () => {
		const { ports, frames, read_closed } = harness(LOCAL_CLOSED, [PLAN])

		read_closed.mockImplementation(async (issues) => merged_closed(issues))
		await tick(FRESH_STATE, ports)

		expect(read_closed).toHaveBeenCalledWith(CHILDREN)

		for (const issue of CHILDREN) {
			expect(row_of(frames.at(-1), issue)).toMatch(
				new RegExp(`✅ ${String(issue)} +Child ${String(issue)} +45:48`, 'u'),
			)
		}
	})

	it('never reads a child it already read closed again', async () => {
		const { ports, read_closed, clock } = harness(LOCAL_CLOSED, [PLAN, PLAN])

		read_closed.mockImplementation(async (issues) => merged_closed(issues))
		const first = await tick(FRESH_STATE, ports)

		clock.now_ms += PLAN_RETRY_MS
		await tick(first, ports)

		expect(read_closed).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#3577: a closed child's labels are read with its title, so its row keeps its kind.
describe('run_board_tick.tick — the release kind of a closed child', () => {
	it('draws a closed child with the release kind its labels place it in', async () => {
		const { ports, frames, read_closed } = harness(LOCAL_CLOSED, [PLAN])

		read_closed.mockImplementation(async (issues) => merged_closed(issues, ['bug']))
		await tick(FRESH_STATE, ports)

		expect(row_of(frames.at(-1), CHILDREN[0] ?? 0)).toContain(
			`✅ ${String(CHILDREN[0])} 🐛 Child ${String(CHILDREN[0])}`,
		)
	})
})

// joshuafolkken/kit#3438: the board opens with the workspace and stays open between runs, so an ended
// run must stop asking GitHub about a child that never answered closed.
describe('run_board_tick.tick — children of an ended run', () => {
	it('asks again after the retry interval while the run is going', async () => {
		const { ports, read_closed, clock } = harness(LOCAL_CLOSED, [PLAN, PLAN])
		const first = await tick(FRESH_STATE, ports)

		clock.now_ms += PLAN_RETRY_MS
		await tick(first, ports)

		expect(read_closed).toHaveBeenCalledTimes(2)
	})

	it('asks once after the run ended and never again', async () => {
		const ended = { ...LOCAL_CLOSED, ended_ms: START }
		const { ports, read_closed, clock } = harness(ended, [PLAN])
		const first = await tick(FRESH_STATE, ports)

		clock.now_ms += PLAN_RETRY_MS
		const second = await tick(first, ports)

		clock.now_ms += PLAN_RETRY_MS
		await tick(second, ports)

		expect(read_closed).toHaveBeenCalledOnce()
	})

	it('asks once more after a run asked while going ended', async () => {
		const ended = { ...LOCAL_CLOSED, ended_ms: START + PLAN_RETRY_MS }
		const { ports, read_closed, read_local, clock } = harness(LOCAL_CLOSED, [PLAN, PLAN])
		const first = await tick(FRESH_STATE, ports)

		read_local.mockResolvedValue(ended)
		clock.now_ms += PLAN_RETRY_MS
		const second = await tick(first, ports)

		clock.now_ms += PLAN_RETRY_MS
		await tick(second, ports)

		expect(read_closed).toHaveBeenCalledTimes(2)
	})
})

// A failed read answers the same nothing as a child still open, so it must not count as the ended run's
// one ask: a merged child would otherwise stay drawn 🏁 until the next run.
describe('run_board_tick.tick — an ended run whose read failed', () => {
	it('asks again until one answers whole', async () => {
		const ended = { ...LOCAL_CLOSED, ended_ms: START }
		const { ports, read_closed, clock } = harness(ended, [PLAN])

		read_closed.mockResolvedValueOnce(FAILED)
		const first = await tick(FRESH_STATE, ports)

		clock.now_ms += PLAN_RETRY_MS
		const second = await tick(first, ports)

		clock.now_ms += PLAN_RETRY_MS
		await tick(second, ports)

		expect(read_closed).toHaveBeenCalledTimes(2)
	})
})
