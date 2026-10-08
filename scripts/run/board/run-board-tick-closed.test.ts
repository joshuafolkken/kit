import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_fixture } from './run-board-fixture'
import type { BoardPlan } from './run-board-layout'
import { run_board_tick } from './run-board-tick'

// joshuafolkken/kit#3451: a board opened after a run's children closed drew them from the stream alone —
// three `child-launch` events and nothing else — as `🏁 3439` with no title and no time. A child the
// open listing no longer holds is read closed from GitHub once, then drawn with its title, its time and
// whether it merged.

const { LOCAL, WORDS, harness } = run_board_fixture
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

function merged_closed(issues: ReadonlyArray<number>): ReadonlyMap<number, ClosedIssue> {
	return new Map(
		issues.map((issue) => [
			issue,
			{ title: `Child ${String(issue)}`, closed_ms: CLOSED_MS, is_merged: true },
		]),
	)
}

function row_of(frame: string | undefined, issue: number): string | undefined {
	return frame?.split('\n').find((line) => line.includes(String(issue)))
}

describe('run_board_tick.tick — children that closed', () => {
	it('draws a closed child nameless and timeless while GitHub has not answered', async () => {
		const { ports, frames } = harness(LOCAL_CLOSED, [PLAN])

		await tick(FRESH_STATE, ports, WORDS)

		expect(row_of(frames.at(-1), 3439)?.trim()).toBe('🏁 3439')
	})

	it('draws each child read closed with its title, time and merge', async () => {
		const { ports, frames, read_closed } = harness(LOCAL_CLOSED, [PLAN])

		read_closed.mockImplementation(async (issues) => merged_closed(issues))
		await tick(FRESH_STATE, ports, WORDS)

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
		const first = await tick(FRESH_STATE, ports, WORDS)

		clock.now_ms += PLAN_RETRY_MS
		await tick(first, ports, WORDS)

		expect(read_closed).toHaveBeenCalledOnce()
	})
})
