import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { BoardPlan, RowReason } from './run-board-layout'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3750: three `auto-ok` rows stood at one `⏳` — two nobody had judged, one judged
// and held by them — and two more waited on a file a running issue declared; none of it was on the row.

const REPO = 'joshuafolkken/kit'
const KIND = run_event_stream.EVENT_KIND
const AT_MS = Date.parse('2026-10-13T09:00:00.000Z')
const SECOND = 1000
const UNTRIAGED = 3727
const HELD = 3714
const OPENING = 3720
const BLOCKER = 3409
const RUNNING = 3701
const SHARED = 'package.json'
const NO_LANE_LEFT = 0
const ONE_LANE_LEFT = 1
const UNTRIAGED_WORD = 'untriaged'
const HELD_WORD = 'held by triage'
const OPENING_WORD = 'opening lane'
const NO_LANE_WORD = 'no free lane'
const OVERLAP = `overlaps ${String(RUNNING)} (${SHARED})`
const DECLARED = new Map([
	[RUNNING, new Set([SHARED])],
	[HELD, new Set([SHARED])],
])
const STATUSES = new Map<number, ItemStatus>([[RUNNING, { state: 'running' }]])

// One event, as its kind and text.
type Step = [string, string]

function child(
	number: number,
	blocked_by: Array<number> = [],
	labels = [RUN_LANE_LABEL],
): EpicChild {
	const edges = blocked_by.map((blocker) => ({ repo: REPO, number: blocker }))

	return { number, repo: REPO, state: 'OPEN', labels, blocked_by: edges }
}

function untriaged(number: number, blocked_by: Array<number> = []): EpicChild {
	return child(number, blocked_by, [])
}

function plan_of(children: Array<EpicChild>, declared?: BoardPlan['declared']): BoardPlan {
	const numbers = children.map((item) => item.number)

	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers: new Set([...numbers, BLOCKER]) },
		labels: new Map(),
		declared,
	}
}

function setup(text: string): Step {
	return [KIND.SETUP, text]
}

// Each step a second after the one before it.
function stream(steps: ReadonlyArray<Step>): Array<RunEvent> {
	return steps.map(([kind, text], index) => ({
		pos: index + 1,
		at: new Date(AT_MS + index * SECOND).toISOString(),
		kind,
		text,
	}))
}

function read_of(plan: BoardPlan, extra: Partial<ReasonRead> = {}): ReasonRead {
	return {
		plan,
		statuses: new Map(),
		events: [],
		free_lanes: ONE_LANE_LEFT,
		is_stopped: false,
		...extra,
	}
}

function reasons(children: Array<EpicChild>, extra: Partial<ReasonRead> = {}): Array<unknown> {
	const read = read_of(extra.plan ?? plan_of(children), extra)
	const reason_of = run_board_reason.reader(read)

	return children.map((item) => reason_of(item)?.text)
}

const OPENING_STEP = setup(run_event_setup.opening_lane(String(OPENING)))
const INSTALLING_STEP = setup(run_event_setup.installing(String(OPENING)))
const DISPATCHING_STEP = setup(run_event_setup.dispatching(String(OPENING)))

// What the row of the lane being opened says after `steps`.
function stage_of(steps: Array<Step>, extra: Partial<ReasonRead> = {}): RowReason | undefined {
	const item = child(OPENING)
	const read = read_of(plan_of([item]), { events: stream(steps), ...extra })

	return run_board_reason.reader(read)(item)
}

describe('run_board_reason.reader — a row nobody has judged', () => {
	it('says a row with neither run label is untriaged', () => {
		expect(reasons([untriaged(UNTRIAGED)])).toStrictEqual([UNTRIAGED_WORD])
	})

	it('says a judged row is held by triage while an untriaged one withholds the pool', () => {
		const pool = [untriaged(UNTRIAGED), child(HELD)]

		expect(reasons(pool)).toStrictEqual([UNTRIAGED_WORD, HELD_WORD])
	})

	it('holds nothing for an untriaged row a blocker keeps out of the pool', () => {
		const pool = [untriaged(UNTRIAGED, [BLOCKER]), child(HELD)]

		expect(reasons(pool)).toStrictEqual([UNTRIAGED_WORD, undefined])
	})

	it('says nothing of a judged row nothing keeps waiting', () => {
		expect(reasons([child(HELD)])).toStrictEqual([undefined])
	})
})

describe('run_board_reason.reader — a row a blocker keeps waiting', () => {
	it('leaves a blocked row to its 🔗, whatever else would keep it', () => {
		const blocked = child(HELD, [BLOCKER])

		expect(reasons([blocked], { free_lanes: NO_LANE_LEFT })).toStrictEqual([undefined])
	})

	it('says a blocked row nobody has judged is untriaged beside its 🔗', () => {
		expect(reasons([untriaged(UNTRIAGED, [BLOCKER])])).toStrictEqual([UNTRIAGED_WORD])
	})
})

describe('run_board_reason.reader — a row the pool keeps waiting', () => {
	it('names the running issue and the file a row’s declared path overlaps', () => {
		const plan = plan_of([child(HELD)], DECLARED)

		expect(reasons([child(HELD)], { plan, statuses: STATUSES })).toStrictEqual([OVERLAP])
	})

	it('weighs a declared path against running issues alone', () => {
		const plan = plan_of([child(HELD)], DECLARED)
		const merged = new Map<number, ItemStatus>([[RUNNING, { state: 'merged' }]])

		expect(reasons([child(HELD)], { plan, statuses: merged })).toStrictEqual([undefined])
	})

	// joshuafolkken/kit#3893: a child that died still holds its lane and the paths it declared.
	it('weighs a declared path against a stopped child whose lane is still open', () => {
		const plan = plan_of([child(HELD)], DECLARED)
		const stopped = new Map<number, ItemStatus>([
			[RUNNING, { state: 'stopped', lane: `lane ${String(RUNNING)}` }],
		])

		expect(reasons([child(HELD)], { plan, statuses: stopped })).toStrictEqual([OVERLAP])
	})

	it('says no lane is free once the open lanes reach the limit', () => {
		expect(reasons([child(HELD)], { free_lanes: NO_LANE_LEFT })).toStrictEqual([NO_LANE_WORD])
	})

	it('says nothing of the lanes where the limit could not be read', () => {
		expect(reasons([child(HELD)], { free_lanes: undefined })).toStrictEqual([undefined])
	})

	it('answers in the order the offer does: triage, then the overlap, then the lanes', () => {
		const pool = [untriaged(UNTRIAGED), child(HELD)]
		const full = { statuses: STATUSES, free_lanes: NO_LANE_LEFT }
		const held = reasons(pool, { ...full, plan: plan_of(pool, DECLARED) })
		const alone = reasons([child(HELD)], { ...full, plan: plan_of([child(HELD)], DECLARED) })

		expect(held[1]).toBe(HELD_WORD)
		expect(alone).toStrictEqual([OVERLAP])
	})
})

describe('run_board_reason.reader — a row whose lane is being opened', () => {
	it.each([
		[OPENING_WORD, [OPENING_STEP]],
		['installing', [OPENING_STEP, INSTALLING_STEP]],
		['dispatching', [OPENING_STEP, INSTALLING_STEP, DISPATCHING_STEP]],
	])('says "%s" with the time the lane entered it', (text, steps) => {
		const since_ms = AT_MS + (steps.length - 1) * SECOND

		expect(stage_of(steps)).toStrictEqual({ text, since_ms })
	})

	it('gives each of two lanes opened side by side its own stage', () => {
		const pool = [child(OPENING), child(HELD)]
		const opening_other = setup(run_event_setup.opening_lane(String(HELD)))
		const events = stream([OPENING_STEP, opening_other, INSTALLING_STEP])

		expect(reasons(pool, { events })).toStrictEqual(['installing', OPENING_WORD])
	})

	it('says the stage before anything else the row would say', () => {
		const stage = stage_of([OPENING_STEP], { free_lanes: NO_LANE_LEFT })

		expect(stage?.text).toBe(OPENING_WORD)
	})
})

describe('run_board_reason.reader — a lane that is no longer being opened', () => {
	it('says no stage once the child has launched', () => {
		const launch: Step = [KIND.CHILD_LAUNCH, `#${String(OPENING)} launched`]

		expect(stage_of([OPENING_STEP, launch])).toBeUndefined()
	})

	it('says no stage of a stopped run, whose stream only ends on one', () => {
		expect(stage_of([OPENING_STEP], { is_stopped: true })).toBeUndefined()
	})
})

// joshuafolkken/kit#3967: a `--only` run's rows read `no free lane` while lanes an earlier run left
// filled the limit, and nothing on the row said which lanes those were.
describe('run_board_reason.reader names the lanes that fill the limit', () => {
	it('lists the occupying issues after no free lane', () => {
		const full = { free_lanes: NO_LANE_LEFT, occupied_lanes: ['3943', '3948'] }

		expect(reasons([child(HELD)], full)).toStrictEqual(['no free lane — 3943 3948'])
	})

	it('keeps the bare words when no occupying lane is known', () => {
		const full = { free_lanes: NO_LANE_LEFT, occupied_lanes: [] }

		expect(reasons([child(HELD)], full)).toStrictEqual([NO_LANE_WORD])
	})
})

// joshuafolkken/kit#4014: a row whose body declared a start time still ahead stood at `⏳` with no
// word of why, while `backlog:next` withheld it for exactly that.
const FUTURE = '2999-01-01T00:00Z'
const PAST = '2000-01-01T00:00Z'

function not_before(date: string, blocked_by: Array<number> = []): EpicChild {
	return { ...child(HELD, blocked_by), body: `## 背景\n\n- 実施可能日: ${date}\n` }
}

describe('run_board_reason.reader — a row whose declared start time is ahead', () => {
	it('says the time a row may not start before', () => {
		expect(reasons([not_before(FUTURE)])).toStrictEqual([`not before ${FUTURE}`])
	})

	it('says the start time before the lanes a full pool would name', () => {
		const pool = [not_before(FUTURE)]

		expect(reasons(pool, { free_lanes: NO_LANE_LEFT })).toStrictEqual([`not before ${FUTURE}`])
	})

	it('goes on to the pool’s reasons once the declared time has passed', () => {
		const pool = [not_before(PAST)]

		expect(reasons(pool, { free_lanes: NO_LANE_LEFT })).toStrictEqual([NO_LANE_WORD])
	})

	it('leaves a blocked row to its 🔗 whatever start time it declares', () => {
		expect(reasons([not_before(FUTURE, [BLOCKER])])).toStrictEqual([undefined])
	})
})
