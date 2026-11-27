import type { OpenListing } from '#scripts/backlog/backlog-plan-read'
import { gh_request_tally, type GhRequestTally } from '#scripts/gh/gh-request-tally'
import { launch_timing } from '#scripts/lane/launch-timing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_board_plan, type PlanPorts } from './run-board-plan'

// joshuafolkken/kit#8218: `run:board --timing` names each step of the plan read and the `gh` calls it sent.

const { GH_CALLS_PHASE, GH_NOT_MODIFIED_PHASE, read_plan } = run_board_plan
const SENT = 5
const NOT_MODIFIED = 3
const ROW = { number: 1, title: 'One', createdAt: '2026-10-01T00:00:00Z' }

function tally(calls: number, not_modified: number): GhRequestTally {
	return { calls, not_modified, endpoints: {} }
}

const POOL_ONLY = { issues: [], only: false }
const LIST_PHASE = 'plan: list'
const POOL_PHASE = 'plan: pool'

// The listing given and an opted-in read that fails, so the read ends with no plan and no `gh` call.
function ports(rows: OpenListing['rows'] = [ROW]): PlanPorts {
	return {
		fetch_open: vi.fn(async () => ({ rows, is_capped: false })),
		fetch_opted_in: vi.fn(async () => ({ kind: 'blockers_unreadable' as const })),
		fetch_relations: vi.fn(async () => undefined),
		classify: vi.fn(async () => undefined),
	}
}

function phase_names(): Array<string> {
	return launch_timing.phases().map(({ name }) => name)
}

beforeEach(() => {
	launch_timing.clear()
	vi.spyOn(gh_request_tally, 'snapshot')
		.mockReturnValueOnce(tally(1, 1))
		.mockReturnValueOnce(tally(1 + SENT, 1 + NOT_MODIFIED))
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_plan.read_plan timing', () => {
	it('times the listing, the pool, the decisions and the pull requests as plan phases', async () => {
		await read_plan(POOL_ONLY, ports())

		expect(phase_names()).toStrictEqual(
			expect.arrayContaining([LIST_PHASE, POOL_PHASE, 'plan: decisions', 'plan: prs']),
		)
	})

	it('counts the gh calls and the 304s the read sent between its start and its end', async () => {
		await read_plan(POOL_ONLY, ports())
		const phases = launch_timing.phases()

		expect(phases).toContainEqual({ name: GH_CALLS_PHASE, ms: SENT })
		expect(phases).toContainEqual({ name: GH_NOT_MODIFIED_PHASE, ms: NOT_MODIFIED })
	})

	// joshuafolkken/kit#8220: the pool is read beside the listing, so its phase is recorded too.
	it('still counts the calls of a read that ends at an empty listing', async () => {
		await expect(read_plan(POOL_ONLY, ports([]))).resolves.toBeUndefined()

		expect(phase_names()).toStrictEqual([
			LIST_PHASE,
			POOL_PHASE,
			GH_CALLS_PHASE,
			GH_NOT_MODIFIED_PHASE,
		])
	})
})
