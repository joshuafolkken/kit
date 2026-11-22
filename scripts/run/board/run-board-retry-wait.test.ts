import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { issue_observation_fixture as observation } from '#scripts/issue/issue-observation-fixture'
import { issue_observation_gate } from '#scripts/issue/issue-observation-gate'
import { afterEach, describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_reason } from './run-board-reason'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#7488: an issue `run:add --retry` queued settles as waiting before it launched; the
// plan that leaves it unreached draws it in the waiting section with its reason, not as an empty lane.

const { header, lines_of } = run_board_render_fixture
const { WAIT_ICONS } = run_board_labels
const REPO = 'joshuafolkken/kit'
const UPSTREAM_REPO = 'joshuafolkken/app-kit'
const WAITS = 7400
const NEXT = 7401
const NOW_MS = Date.parse('2026-11-14T06:00:00.000Z')
const RETRIED: ItemStatus = { state: 'waiting', started_ms: undefined }
const RELAUNCHED: ItemStatus = { state: 'waiting', started_ms: NOW_MS }
const FREE_LANE = 'retry · → next free lane'
const MISSING = 'observation evidence required: multi-slot, comparison, cost'

function child(number: number, body?: string): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [RUN_LANE_LABEL], blocked_by: [], body }
}

function plan_of(
	waves: Array<EpicChild>,
	unreached: Array<EpicChild>,
	open_blockers: Array<number> = [],
): BoardPlan {
	const numbers = [...waves, ...unreached].map((item) => item.number)
	const titles = new Map(numbers.map((number) => [number, `Issue ${String(number)}`]))

	return {
		waves: { waves: waves.length > 0 ? [waves] : [], unreached },
		tracked: new Map(),
		context: { repo: REPO, titles, open_numbers: new Set([...numbers, ...open_blockers]) },
		labels: new Map(),
	}
}

function layout_of(plan: BoardPlan, status: ItemStatus, issue = WAITS): BoardLayout {
	const statuses = new Map([[issue, status]])
	const read = { plan, statuses, events: [], free_lanes: 1, is_stopped: false, now_ms: NOW_MS }

	return run_board_layout.layout_of(
		{ ...plan, now_ms: NOW_MS },
		statuses,
		run_board_reason.reader(read),
	)
}

function markdown_link(text: string, url: string): string {
	return `[${text}](${url})`
}

const UPSTREAM_NAMED = '🔗 app-kit#7691'

function text_of(layout: BoardLayout): string {
	return lines_of(header({ layout })).join('\n')
}

function reason_of(layout: BoardLayout): BoardLayout['active'][number]['reason'] {
	return layout.active.find((row) => row.number === WAITS)?.reason
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

// joshuafolkken/kit#7695: an upstream interrupt parks its lane on a blocker in another repository.
describe('run_board_layout.layout_of — a lane held by an upstream interrupt', () => {
	const UPSTREAM = { repo: UPSTREAM_REPO, number: 7691 }

	function held(state: 'OPEN' | 'CLOSED'): EpicChild {
		return { ...child(WAITS), blocked_by: [{ ...UPSTREAM, state }] }
	}

	// A closed upstream Issue still holds the child until its release lands (`epic_outside_blocker`).
	it.each(['OPEN', 'CLOSED'] as const)(
		'keeps the ⏳ lane row and names the %s upstream Issue at its line end',
		(state) => {
			const layout = layout_of(plan_of([], [held(state)]), RETRIED)

			expect(numbers_of(layout.active)).toStrictEqual([WAITS])
			expect(numbers_of(layout.unreached)).toStrictEqual([])
			expect(layout.active[0]?.waits).toStrictEqual(['app-kit#7691'])
			expect(text_of(layout)).toContain(UPSTREAM_NAMED)
		},
	)
})

// joshuafolkken/kit#7901: each ⏳ lane row's line end says why it waits and what starts it.
// The lane rows alone: a ⏳ row opens with its indent, the header and section rules do not.
const LANE_ROW = /^\s+⏳/u

function hourglass_lines(layout: BoardLayout): Array<string> {
	return lines_of(header({ layout })).filter((line) => LANE_ROW.test(line))
}

function blocked_layout(blocker: EpicChild['blocked_by'][number], status: ItemStatus): BoardLayout {
	const plan = plan_of([], [{ ...child(WAITS), blocked_by: [blocker] }], [blocker.number])

	return layout_of(plan, status)
}

describe('run_board_layout.layout_of — a ⏳ lane row line end', () => {
	it('draws a retry, a blocker here and an upstream Issue with their next moves', () => {
		const upstream = { repo: UPSTREAM_REPO, number: 7691, state: 'OPEN' } as const
		const local = { repo: REPO, number: 7228, state: 'OPEN' } as const
		const free = layout_of(plan_of([child(NEXT)], []), RETRIED, NEXT)
		const lines = [
			...hourglass_lines(free),
			...hourglass_lines(blocked_layout(local, RELAUNCHED)),
			...hourglass_lines(blocked_layout(upstream, RETRIED)),
		]

		expect(lines).toMatchSnapshot()
	})
})

// joshuafolkken/kit#8084: one that launched, parked and was re-queued with a start date ahead waits on
// that date in the waiting section; past the date it is the retry a free lane starts.
describe('run_board_layout.layout_of — a re-queued issue that launched before and has a start date', () => {
	const AHEAD = '## 背景\n\n- 実施可能日: 2026-11-25T09:00Z\n'
	const PASSED = '## 背景\n\n- 実施可能日: 2026-11-13T09:00Z\n'

	it('draws a date still ahead as a 📅 row in the waiting section, not as a free-lane retry', () => {
		const layout = layout_of(plan_of([], [child(WAITS, AHEAD)]), RELAUNCHED)
		const text = text_of(layout)

		expect(numbers_of(layout.active)).toStrictEqual([])
		expect(numbers_of(layout.unreached)).toStrictEqual([WAITS])
		expect(text).toContain('📅')
		expect(hourglass_lines(layout)).toStrictEqual([])
		expect(text).not.toContain(FREE_LANE)
	})

	it('keeps a passed date with no blocker as a ⏳ lane row a free lane starts', () => {
		const layout = layout_of(plan_of([], [child(WAITS, PASSED)]), RELAUNCHED)
		const [line] = hourglass_lines(layout)

		expect(numbers_of(layout.active)).toStrictEqual([WAITS])
		expect(numbers_of(layout.unreached)).toStrictEqual([])
		expect(line).toContain(FREE_LANE)
	})

	it('keeps a row an upstream Issue holds in the lanes while its date is ahead', () => {
		const upstream = { repo: UPSTREAM_REPO, number: 7691, state: 'OPEN' } as const
		const held = { ...child(WAITS, AHEAD), blocked_by: [upstream] }
		const layout = layout_of(plan_of([], [held]), RELAUNCHED)

		expect(numbers_of(layout.active)).toStrictEqual([WAITS])
		expect(numbers_of(layout.unreached)).toStrictEqual([])
		expect(text_of(layout)).toContain(UPSTREAM_NAMED)
	})
})

// joshuafolkken/kit#8497: a relaunched retry the offer holds on a running lane's declared path says so
// as the plan row would, rather than waiting on a free lane.
describe('run_board_layout.layout_of — a relaunched retry a running lane holds on a path', () => {
	const RUNNING = 7402
	const SHARED = 'scripts/run/board/run-board-layout.ts'
	const OVERLAP = { icon: WAIT_ICONS.path, issues: [String(RUNNING)], tail: SHARED }

	function held_layout(declared: BoardPlan['declared']): BoardLayout {
		const plan = { ...plan_of([child(WAITS)], []), declared }
		const statuses = new Map<number, ItemStatus>([
			[WAITS, RELAUNCHED],
			[RUNNING, { state: 'running' }],
		])
		const read = { plan, statuses, events: [], free_lanes: 1, is_stopped: false, now_ms: NOW_MS }

		return run_board_layout.layout_of(plan, statuses, run_board_reason.reader(read))
	}

	it('draws the 📂 holder and path the plan row draws', () => {
		const declared = new Map([
			[RUNNING, new Set([SHARED])],
			[WAITS, new Set([SHARED])],
		])

		expect(reason_of(held_layout(declared))).toStrictEqual(OVERLAP)
	})

	it('keeps the free-lane retry tail where no path is shared', () => {
		const declared = new Map([[RUNNING, new Set([SHARED])]])

		expect(reason_of(held_layout(declared))).toStrictEqual({ tail: FREE_LANE })
	})
})
