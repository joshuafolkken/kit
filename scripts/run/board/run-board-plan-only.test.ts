import type { OptedIn } from '#scripts/backlog/backlog-gate-scope'
import type { Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { git_gh_conditional } from '#scripts/gh/git-gh-conditional'
import { TRANSPORT_ENV_VAR } from '#scripts/gh/git-gh-transport'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_plan, type PlanPorts } from './run-board-plan'
import { run_board_scope } from './run-board-scope'

// joshuafolkken/kit#8958: a bare `backlogrun --only` (an empty plan, waiting for `run:add`) drew the whole
// opted-in pool as queued work the driver never runs.

const REPO = 'joshuafolkken/kit'
const ADDED = 8900
const POOL = [8901, 8902]

function row(number: number): OpenIssueData {
	return { number, title: `issue ${String(number)}`, createdAt: '2026-11-26T00:00:00Z' }
}

function child(number: number): EpicChild {
	return { number, repo: REPO, state: 'OPEN', labels: [], blocked_by: [] }
}

function plan_of(opted_in: OptedIn, exclude: ReadonlyArray<number>): Plan {
	const waiting = opted_in.issues
		.filter((issue) => !exclude.includes(issue.number))
		.map((issue) => child(issue.number))

	return {
		result: { verdict: 'wait', candidates: [], waiting, blocked_on_people: [], anomalies: [] },
		repo: REPO,
		exclude,
		tracked: new Map(),
		scope: { standalone: new Set(), declared: new Map() },
	}
}

function ports(): PlanPorts {
	return {
		fetch_open: vi.fn(async () => ({
			rows: [ADDED, ...POOL].map((number) => row(number)),
			is_capped: false,
		})),
		fetch_opted_in: vi.fn(async () => ({
			kind: 'read' as const,
			issues: POOL.map((number) => row(number)),
			cutoff: 'none' as const,
		})),
		classify: vi.fn(async (opted_in: OptedIn, exclude: ReadonlyArray<number>) =>
			plan_of(opted_in, exclude),
		),
	}
}

function drawn(plan: Awaited<ReturnType<typeof run_board_plan.read_plan>>): Array<number> {
	const { waves, unreached } = plan?.waves ?? { waves: [], unreached: [] }

	return [...waves.flat(), ...unreached].map((entry) => entry.number)
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
		const scope = run_board_scope.scope_of('backlogrun --only', [
			{ issue: ADDED, is_priority: true },
		])
		const plan = await run_board_plan.read_plan(scope, read)

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
