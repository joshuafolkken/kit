import type { EpicChild } from '#scripts/epic/epic-graph'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { figure_format } from '#scripts/lib/figure-format'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardPlan, RowReason } from './run-board-layout'
import type { MachineGauges } from './run-board-machine'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3750: three `auto-ok` rows stood at one `⏳` — two nobody had judged, one judged
// and held by them — and two more waited on a file a running issue declared; none of it was on the row.
// joshuafolkken/kit#4288: each reason is one `{ icon, value, tail }` its row only draws.

const REPO = 'joshuafolkken/kit'
const KIND = run_event_stream.EVENT_KIND
const AT_MS = Date.parse('2026-10-13T09:00:00.000Z')
const SECOND = 1000
const UNTRIAGED = 3727
const HELD = 3714
const OPENING = 3720
const BLOCKER = 3409
const OTHER_BLOCKER = 3410
const RUNNING = 3701
const SHARED = 'package.json'
const NO_LANE_LEFT = 0
const ONE_LANE_LEFT = 1
const { STAGE_ICONS, WAIT_ICONS } = run_board_labels
const { LANE_STAGE } = run_event_setup
const UNTRIAGED_REASON: RowReason = { icon: WAIT_ICONS.untriaged, issues: [] }
// joshuafolkken/kit#4288: ✋ names the untriaged issue the pool is held for.
const HELD_REASON: RowReason = { icon: WAIT_ICONS.held, issues: [String(UNTRIAGED)] }
// joshuafolkken/kit#4137: a queued row says what it starts after.
const NO_LANE_REASON: RowReason = { icon: WAIT_ICONS.lane }
const OVERLAP: RowReason = { icon: WAIT_ICONS.path, issues: [String(RUNNING)], tail: SHARED }
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
	const open_numbers = new Set([...numbers, BLOCKER, OTHER_BLOCKER])

	return {
		waves: { waves: [children], unreached: [] },
		tracked: new Map(),
		context: { repo: REPO, titles: new Map(), open_numbers },
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

// The blockers a row's layout hands its reason: every one the test's plan names stands.
function waits_of(item: EpicChild): Array<string> {
	return item.blocked_by.map((edge) => String(edge.number))
}

function reasons(
	children: Array<EpicChild>,
	extra: Partial<ReasonRead> = {},
): Array<RowReason | undefined> {
	const read = read_of(extra.plan ?? plan_of(children), extra)
	const reason_of = run_board_reason.reader(read)

	return children.map((item) => reason_of(item, waits_of(item)))
}

const OPENING_STEP = setup(run_event_setup.opening_lane(String(OPENING)))
const INSTALLING_STEP = setup(run_event_setup.installing(String(OPENING)))
const DISPATCHING_STEP = setup(run_event_setup.dispatching(String(OPENING)))

// What the row of the lane being opened says after `steps`.
function stage_of(steps: Array<Step>, extra: Partial<ReasonRead> = {}): RowReason | undefined {
	const item = child(OPENING)
	const read = read_of(plan_of([item]), { events: stream(steps), ...extra })

	return run_board_reason.reader(read)(item, [])
}

describe('run_board_reason.reader — a row nobody has judged', () => {
	it('leads a row with neither run label with ❓', () => {
		expect(reasons([untriaged(UNTRIAGED)])).toStrictEqual([UNTRIAGED_REASON])
	})

	it('names the untriaged issue a judged row is held by while it withholds the pool', () => {
		const pool = [untriaged(UNTRIAGED), child(HELD)]

		expect(reasons(pool)).toStrictEqual([UNTRIAGED_REASON, HELD_REASON])
	})

	it('holds nothing for an untriaged row a blocker keeps out of the pool', () => {
		const pool = [untriaged(UNTRIAGED, [BLOCKER]), child(HELD)]

		expect(reasons(pool)[1]).toBeUndefined()
	})

	it('says nothing of a judged row nothing keeps waiting', () => {
		expect(reasons([child(HELD)])).toStrictEqual([undefined])
	})
})

describe('run_board_reason.reader — a row a blocker keeps waiting', () => {
	it('leads a blocked row with 🔗 and its blockers, whatever else would keep it', () => {
		const blocked = child(HELD, [BLOCKER, OTHER_BLOCKER])
		const issues = [String(BLOCKER), String(OTHER_BLOCKER)]

		expect(reasons([blocked], { free_lanes: NO_LANE_LEFT })).toStrictEqual([
			{ icon: WAIT_ICONS.blocker, issues },
		])
	})

	it('leads a blocked row nobody has judged with ❓ and its first blocker alone', () => {
		const blocked = untriaged(UNTRIAGED, [BLOCKER, OTHER_BLOCKER])

		expect(reasons([blocked])).toStrictEqual([
			{ icon: WAIT_ICONS.untriaged, issues: [String(BLOCKER)] },
		])
	})
})

// joshuafolkken/kit#4270: a paused lane held five rows back for 1 h 40 min with no word of why.
describe('run_board_reason.reader — a paused holder', () => {
	it('names when and by what the holder was paused after the path', () => {
		const plan = plan_of([child(HELD)], DECLARED)
		const ended_ms = Date.parse('2026-10-20T01:28:00.000Z')
		const lane = `lane ${String(RUNNING)}`
		const status: ItemStatus = { state: 'paused', lane, ended_ms, paused_by: 'lane:pause' }
		const tail = `${SHARED} — paused since ${figure_format.minute_of(ended_ms)} by lane:pause`
		const statuses = new Map([[RUNNING, status]])

		expect(reasons([child(HELD)], { plan, statuses })).toStrictEqual([{ ...OVERLAP, tail }])
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

	it('leads with 🧵 once the open lanes reach the limit', () => {
		expect(reasons([child(HELD)], { free_lanes: NO_LANE_LEFT })).toStrictEqual([NO_LANE_REASON])
	})

	it('says nothing of the lanes where the limit could not be read', () => {
		expect(reasons([child(HELD)], { free_lanes: undefined })).toStrictEqual([undefined])
	})

	it('answers in the order the offer does: triage, then the overlap, then the lanes', () => {
		const pool = [untriaged(UNTRIAGED), child(HELD)]
		const full = { statuses: STATUSES, free_lanes: NO_LANE_LEFT }
		const held = reasons(pool, { ...full, plan: plan_of(pool, DECLARED) })
		const alone = reasons([child(HELD)], { ...full, plan: plan_of([child(HELD)], DECLARED) })

		expect(held[1]).toStrictEqual(HELD_REASON)
		expect(alone).toStrictEqual([OVERLAP])
	})
})

describe('run_board_reason.reader — a row whose lane is being opened', () => {
	it.each([
		[LANE_STAGE.OPENING, [OPENING_STEP]],
		[LANE_STAGE.INSTALLING, [OPENING_STEP, INSTALLING_STEP]],
		[LANE_STAGE.DISPATCHING, [OPENING_STEP, INSTALLING_STEP, DISPATCHING_STEP]],
	])('leads with the "%s" stage’s icon and the time the lane entered it', (stage, steps) => {
		const since_ms = AT_MS + (steps.length - 1) * SECOND

		expect(stage_of(steps)).toStrictEqual({ icon: STAGE_ICONS[stage], since_ms })
	})

	it('gives each of two lanes opened side by side its own stage', () => {
		const pool = [child(OPENING), child(HELD)]
		const opening_other = setup(run_event_setup.opening_lane(String(HELD)))
		const events = stream([OPENING_STEP, opening_other, INSTALLING_STEP])

		expect(reasons(pool, { events }).map((reason) => reason?.icon)).toStrictEqual([
			STAGE_ICONS[LANE_STAGE.INSTALLING],
			STAGE_ICONS[LANE_STAGE.OPENING],
		])
	})

	it('says the stage before anything else the row would say', () => {
		const stage = stage_of([OPENING_STEP], { free_lanes: NO_LANE_LEFT })

		expect(stage?.icon).toBe(STAGE_ICONS[LANE_STAGE.OPENING])
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

// joshuafolkken/kit#4111: every waiting row repeated the same lane breakdown after `next free lane`.
const LANE_LIMIT = 4

describe('run_board_reason.reader counts the lanes that fill the limit', () => {
	const full = { free_lanes: NO_LANE_LEFT, lane_limit: LANE_LIMIT, occupied_count: LANE_LIMIT }

	it('says the count against the limit and names no lane', () => {
		expect(reasons([child(HELD)], full)).toStrictEqual([{ icon: WAIT_ICONS.lane, value: '4/4' }])
	})

	it('draws no count where the limit could not be read', () => {
		const unread = { ...full, lane_limit: undefined }

		expect(reasons([child(HELD)], unread)).toStrictEqual([NO_LANE_REASON])
	})
})

// joshuafolkken/kit#4014: a row whose body declared a start time still ahead stood at `⏳` with no
// word of why, while `backlog:next` withheld it for exactly that.
const FUTURE = '2999-01-01T00:00Z'
const PAST = '2000-01-01T00:00Z'
const FUTURE_REASON: RowReason = {
	icon: WAIT_ICONS.not_before,
	value: run_board_labels.day_minute_of(Date.parse(FUTURE)),
	not_before_ms: Date.parse(FUTURE),
}

function not_before(date: string, blocked_by: Array<number> = []): EpicChild {
	return { ...child(HELD, blocked_by), body: `## 背景\n\n- 実施可能日: ${date}\n` }
}

describe('run_board_reason.reader — a row whose declared start time is ahead', () => {
	// joshuafolkken/kit#4017: in the local time every other time on the board reads in, not UTC.
	it('says the local time a row may not start before', () => {
		expect(reasons([not_before(FUTURE)])).toStrictEqual([FUTURE_REASON])
	})

	it('says the start time before the lanes a full pool would name', () => {
		const pool = [not_before(FUTURE)]

		expect(reasons(pool, { free_lanes: NO_LANE_LEFT })).toStrictEqual([FUTURE_REASON])
	})

	it('goes on to the pool’s reasons once the declared time has passed', () => {
		const pool = [not_before(PAST)]

		expect(reasons(pool, { free_lanes: NO_LANE_LEFT })).toStrictEqual([NO_LANE_REASON])
	})

	it('leads a blocked row with 🔗 whatever start time it declares', () => {
		expect(reasons([not_before(FUTURE, [BLOCKER])])[0]?.icon).toBe(WAIT_ICONS.blocker)
	})

	// joshuafolkken/kit#4104: it carries the start time itself, which the 📅 rows are ordered by.
	it('carries the start time on the start-time reason, and none on a reason the pool gives', () => {
		const pool = [not_before(FUTURE), not_before(PAST)]
		const read = read_of(plan_of(pool), { free_lanes: NO_LANE_LEFT })
		const reason_of = run_board_reason.reader(read)

		expect(pool.map((item) => reason_of(item, [])?.not_before_ms)).toStrictEqual([
			Date.parse(FUTURE),
			undefined,
		])
	})
})

// joshuafolkken/kit#4084: a row the driver holds for memory says so, with the figures it was held on.
const PRESSED: MachineGauges = {
	cpu_percent: undefined,
	memory_percent: 88,
	swap_mb_per_s: 12,
	memory_pressure: undefined,
}

describe('run_board_reason.reader — a row the machine’s memory keeps waiting', () => {
	it('leads with 🧠 and its figure, and leaves the 💾 figure to the row’s end', () => {
		const held = { is_memory_held: true, gauges: PRESSED }

		expect(reasons([child(HELD)], held)).toStrictEqual([
			{ icon: WAIT_ICONS.memory, value: '88%', tail: '💾 12M/s' },
		])
	})

	it('draws no figure where none was read', () => {
		expect(reasons([child(HELD)], { is_memory_held: true })).toStrictEqual([
			{ icon: WAIT_ICONS.memory, value: undefined, tail: undefined },
		])
	})

	it('leads with 🧵 first when the lanes are full as well', () => {
		const full = { is_memory_held: true, gauges: PRESSED, free_lanes: NO_LANE_LEFT }

		expect(reasons([child(HELD)], full)).toStrictEqual([NO_LANE_REASON])
	})
})
