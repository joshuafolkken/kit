import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_observation_fixture as observation } from '#scripts/issue/issue-observation-fixture'
import { issue_observation_gate } from '#scripts/issue/issue-observation-gate'
import { afterEach, describe, expect, it } from 'vitest'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_reason } from './run-board-reason'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#7488: an issue `run:add --retry` queued settles as waiting before it launched; the
// plan that leaves it unreached draws it in the waiting section with its reason, not as an empty lane.

const { header, lines_of } = run_board_render_fixture
const REPO = 'joshuafolkken/kit'
const WAITS = 7400
const NEXT = 7401
const NOW_MS = Date.parse('2026-11-14T06:00:00.000Z')
const RETRIED: ItemStatus = { state: 'waiting', started_ms: undefined }
const RELAUNCHED: ItemStatus = { state: 'waiting', started_ms: NOW_MS }
const MISSING = 'observation evidence required: multi-slot, comparison, cost'

function child(number: number, body?: string): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [], body }
}

function plan_of(waves: Array<EpicChild>, unreached: Array<EpicChild>): BoardPlan {
	const numbers = [...waves, ...unreached].map((item) => item.number)
	const titles = new Map(numbers.map((number) => [number, `Issue ${String(number)}`]))

	return {
		waves: { waves: waves.length > 0 ? [waves] : [], unreached },
		tracked: new Map(),
		context: { repo: REPO, titles, open_numbers: new Set(numbers) },
		labels: new Map(),
	}
}

function layout_of(plan: BoardPlan, status: ItemStatus, issue = WAITS): BoardLayout {
	const statuses = new Map([[issue, status]])
	const read = { plan, statuses, events: [], free_lanes: 1, is_stopped: false, now_ms: NOW_MS }

	return run_board_layout.layout_of(plan, statuses, run_board_reason.reader(read))
}

function markdown_link(text: string, url: string): string {
	return `[${text}](${url})`
}

function numbers_of(rows: ReadonlyArray<{ number: number }>): Array<number> {
	return rows.map((row) => row.number)
}

afterEach(() => {
	issue_observation_gate.reset()
})

describe('run_board_layout.layout_of — an issue queued by run:add --retry', () => {
	it('draws an unmet observation wait in the waiting section with its missing keys and evidence', () => {
		issue_observation_gate.record(observation.URL, observation.comment(['same-head']))
		const layout = layout_of(plan_of([], [child(WAITS, observation.BODY)]), RETRIED)
		const text = lines_of(header({ layout, comment_link: markdown_link })).join('\n')

		expect(numbers_of(layout.active)).toStrictEqual([])
		expect(numbers_of(layout.unreached)).toStrictEqual([WAITS])
		expect(layout.unreached[0]?.reason).toMatchObject({
			tail: MISSING,
			evidence_url: observation.URL,
		})
		expect(text).toContain(`](${observation.URL})`)
		expect(text).toContain(MISSING)
	})

	it('keeps an issue the plan starts next in the lanes', () => {
		const layout = layout_of(plan_of([child(NEXT)], []), RETRIED, NEXT)

		expect(numbers_of(layout.active)).toStrictEqual([NEXT])
		expect(numbers_of(layout.unreached)).toStrictEqual([])
	})

	it('keeps an issue that already launched in this run in the lanes', () => {
		const layout = layout_of(plan_of([], [child(WAITS, observation.BODY)]), RELAUNCHED)

		expect(numbers_of(layout.active)).toStrictEqual([WAITS])
		expect(numbers_of(layout.unreached)).toStrictEqual([])
	})
})
