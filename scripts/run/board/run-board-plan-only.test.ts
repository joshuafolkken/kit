import type { OptedIn } from '#scripts/backlog/backlog-gate-scope'
import type { Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { RowReason } from './run-board-layout'
import { run_board_plan, type PlanPorts } from './run-board-plan'
import { run_board_reason, type ReasonRead } from './run-board-reason'
import { run_board_scope } from './run-board-scope'
import { run_board_standing_waits } from './run-board-standing-waits'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#8958: a bare `backlogrun --only` (an empty plan, waiting for `run:add`) drew the whole
// opted-in pool as queued work the driver never runs.

const REPO = 'joshuafolkken/kit'
const ADDED = 8900
const POOL = [8901, 8902]
// An open issue no run holds, and one that has closed — absent from the open listing.
const OUTSIDE = 8950
const CLOSED = 8951

function row(number: number): OpenIssueData {
	return { number, title: `issue ${String(number)}`, createdAt: '2026-11-26T00:00:00Z' }
}

// The row as the relations listing reads it: no `createdAt`, its blockers carried.
function related(number: number, blockers: ReadonlyArray<number>): OpenIssueData {
	const nodes = blockers.map((blocker) => ({ number: blocker }))

	return { ...row(number), createdAt: '', blockedBy: { nodes } }
}

// The classification maps each row's blockers onto its child, as `backlog_next` does; each row is
// one a person has judged, so a blocked one is not drawn as untriaged.
function child(issue: OpenIssueData): EpicChild {
	const edges = (issue.blockedBy?.nodes ?? []).map((node) => ({ repo: REPO, number: node.number }))
	const labels = [RUN_LANE_LABEL]

	return { number: issue.number, repo: REPO, state: 'OPEN', labels, blocked_by: edges }
}

function plan_of(opted_in: OptedIn, exclude: ReadonlyArray<number>): Plan {
	const waiting = opted_in.issues
		.filter((issue) => !exclude.includes(issue.number))
		.map((issue) => child(issue))

	return {
		result: { verdict: 'wait', candidates: [], waiting, blocked_on_people: [], anomalies: [] },
		repo: REPO,
		exclude,
		tracked: new Map(),
		scope: { standalone: new Set(), declared: new Map() },
	}
}

function ports(blockers: ReadonlyArray<number> = []): PlanPorts {
	return {
		fetch_open: vi.fn(async () => ({
			rows: [ADDED, ...POOL, OUTSIDE].map((number) => row(number)),
			is_capped: false,
		})),
		fetch_opted_in: vi.fn(async () => ({
			kind: 'read' as const,
			issues: POOL.map((number) => row(number)),
			cutoff: 'none' as const,
		})),
		fetch_relations: vi.fn(async () => ({ rows: [related(ADDED, blockers)], is_capped: false })),
		classify: vi.fn(async (opted_in: OptedIn, exclude: ReadonlyArray<number>) =>
			plan_of(opted_in, exclude),
		),
	}
}

type ReadPlan = Awaited<ReturnType<typeof run_board_plan.read_plan>>

function children_of(plan: ReadPlan): Array<EpicChild> {
	const { waves, unreached } = plan?.waves ?? { waves: [], unreached: [] }

	return [...waves.flat(), ...unreached]
}

function drawn(plan: ReadPlan): Array<number> {
	return children_of(plan).map((entry) => entry.number)
}

const ADDED_SCOPE = run_board_scope.scope_of('backlogrun --only', [
	{ issue: ADDED, is_priority: true },
])

// The reason the board leads the added issue's `queued` row with, its standing blockers read as the
// layout reads them; `extra` stands for the board's other reads.
async function added_reason(
	blockers: ReadonlyArray<number>,
	extra: Partial<ReasonRead> = {},
): Promise<RowReason | undefined> {
	const plan = await run_board_plan.read_plan(ADDED_SCOPE, ports(blockers))
	const item = children_of(plan).find((entry) => entry.number === ADDED)

	if (plan === undefined || item === undefined) return undefined
	const statuses = new Map<number, ItemStatus>([[POOL[0] ?? ADDED, { state: 'running' }]])
	const read = { plan, statuses, events: [], free_lanes: 1, is_stopped: false, now_ms: 0, ...extra }
	const waits = run_board_standing_waits.waits_of(item, read)

	return run_board_reason.reader(read)(item, waits)
}

beforeEach(() => {
	vi.spyOn(backlog_waves, 'build').mockImplementation((result) => ({
		waves: [result.waiting],
		unreached: [],
	}))
	vi.stubEnv(TRANSPORT_ENV_VAR, 'rest')
	vi.spyOn(git_gh_conditional, 'read_conditional').mockResolvedValue({ kind: 'unreadable' })
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_plan.read_plan a bare --only run', () => {
	it('reads no pool and draws nothing while run:add has handed it nothing', async () => {
		const read = ports()
		const plan = await run_board_plan.read_plan({ issues: [], only: true }, read)

		// An empty plan, not a failed read (`undefined`), so the board draws it rather than keeping the last one.
		expect(plan).toBeDefined()
		expect(drawn(plan)).toStrictEqual([])
		expect(read.fetch_opted_in).not.toHaveBeenCalled()
	})

	it('draws only the issues run:add handed it, never the pool', async () => {
		const read = ports()
		const plan = await run_board_plan.read_plan(ADDED_SCOPE, read)

		expect(drawn(plan)).toStrictEqual([ADDED])
		expect(read.fetch_opted_in).not.toHaveBeenCalled()
	})

	it('still draws the pool for a run without --only and nothing named', async () => {
		const plan = await run_board_plan.read_plan({ issues: [], only: false }, ports())

		expect(drawn(plan)).toStrictEqual(POOL)
	})

	it('counts no waiting issue of the pool', async () => {
		const plan = await run_board_plan.read_plan({ issues: [], only: true }, ports())

		expect(plan?.withheld ?? new Set()).toStrictEqual(new Set())
		expect(plan?.waves.unreached ?? []).toStrictEqual([])
	})
})

// joshuafolkken/kit#8966: the named plan read its rows from a listing with no blockers, so a blocked
// added issue's `queued` row drew a bare ⏳ (or 🧠) rather than 🔗 and its blockers.
describe('run_board_plan.read_plan a blocked issue an --only run names', () => {
	it('leads the row with 🔗 and every standing blocker, running in the run or outside it', async () => {
		const issues = [String(POOL[0]), String(OUTSIDE)]

		await expect(added_reason([POOL[0] ?? ADDED, OUTSIDE])).resolves.toStrictEqual({
			icon: run_board_labels.WAIT_ICONS.blocker,
			issues,
		})
	})

	it('leads the row with 🔗 rather than 🧠 while a free lane is held for memory', async () => {
		const reason = await added_reason([OUTSIDE], { is_memory_held: true })

		expect(reason?.icon).toBe(run_board_labels.WAIT_ICONS.blocker)
	})

	it('drops 🔗 once every blocker has closed', async () => {
		const reason = await added_reason([CLOSED])

		expect(reason?.icon).not.toBe(run_board_labels.WAIT_ICONS.blocker)
	})

	it('still draws the row when the relations are not read', async () => {
		const read = { ...ports([OUTSIDE]), fetch_relations: vi.fn(async () => undefined) }

		expect(drawn(await run_board_plan.read_plan(ADDED_SCOPE, read))).toStrictEqual([ADDED])
	})

	it('reads no relations when the scope names nothing', async () => {
		const read = ports()

		await run_board_plan.read_plan({ issues: [], only: false }, read)

		expect(read.fetch_relations).not.toHaveBeenCalled()
	})
})
