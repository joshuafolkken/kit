import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { gh_core_rate_limit } from '#scripts/gh/gh-core-rate-limit'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { cutoff_of } from '#scripts/git/listing-cutoff'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_plan } from '#scripts/lane/lane-plan'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { backlog_drive, type LoopPorts } from './backlog-drive'
import { backlog_drive_fixture, type Harness } from './backlog-drive-fixture'
import { backlog_drive_named_offer } from './backlog-drive-named-offer'
import { backlog_plan_comment } from './backlog-plan-comment'

const ACTIVE = new Date().toISOString()
const CARRY = {
	invocation: 'backlogrun #1 #2 --max 1',
	started_at: ACTIVE,
	merged: 0,
	filed: 0,
	cuts: 0,
	failures: 0,
	outages: 0,
}
const CONTEXT = { is_only: false, forwarded: ['--max', '1'], owner: String(process.pid) }
const OPEN_STATE = {
	kind: 'state',
	state: { state: 'OPEN', labels: [], is_human_review: false },
} as const
const RUNNING: OpenIssueData = {
	number: 3,
	title: 'running',
	createdAt: '2026-10-25T03:07:44Z',
	blockedBy: undefined,
	labels: [{ name: 'in-progress' }],
	body: '`scripts/lane/lane-overrun.ts`',
}
const LISTING_LIMIT = 100
const DECLARED = new Map([[3, new Set(['scripts/lane/lane-overrun.ts'])]])

// A launch reads the GitHub core allowance: unread here, so no case calls `gh api`.
beforeEach(() => {
	vi.spyOn(gh_core_rate_limit, 'read_core').mockResolvedValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function named_ports(harness: Harness): LoopPorts {
	return {
		...harness.ports,
		offer: async (state) => {
			const { offer } = await backlog_drive_named_offer.read(CARRY, state, CONTEXT)

			return offer
		},
	}
}

// joshuafolkken/kit#4926: a declared issue that gave its lane back waits on its kept plan while the
// lane it yielded to runs, rather than relaunching into the same yield. The running lane's body is read
// with its plan — the scope `lane:plan` yielded on.
test('waits on a declared issue whose yielded plan a lane in flight still holds', async () => {
	vi.spyOn(lane_plan, 'is_yielded').mockImplementation((issue) => issue === 1)
	vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
		kind: 'read',
		issues: [RUNNING],
		cutoff: cutoff_of(1, LISTING_LIMIT, false),
	})
	const declared = vi.spyOn(backlog_plan_comment, 'declared_of').mockResolvedValue(DECLARED)
	const held = vi.spyOn(lane_plan, 'is_yield_held').mockImplementation((issue) => issue === 1)

	const { offer } = await backlog_drive_named_offer.read(
		CARRY,
		backlog_drive.initial_state(['3'], ACTIVE),
		CONTEXT,
	)

	expect(offer?.verdict).toBe('wait')
	expect(declared).toHaveBeenCalledWith([RUNNING], process.cwd())
	expect(held).toHaveBeenCalledWith(1, DECLARED, process.cwd(), undefined)
})

// joshuafolkken/kit#6798: the yielded issue is held on its own declaration — its plan comment when that
// came after the kept plan — not on the kept paths alone.
test('holds a yielded issue on its own declared scope', async () => {
	const scope = new Set(['scripts/issue/issue-read.ts'])

	vi.spyOn(lane_plan, 'is_yielded').mockImplementation((issue) => issue === 1)
	vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
		kind: 'read',
		issues: [RUNNING],
		cutoff: cutoff_of(1, LISTING_LIMIT, false),
	})
	const declared = vi
		.spyOn(backlog_plan_comment, 'declared_of')
		.mockResolvedValueOnce(DECLARED)
		.mockResolvedValueOnce(new Map([[1, scope]]))
	const held = vi.spyOn(lane_plan, 'is_yield_held').mockImplementation((issue) => issue === 1)

	await backlog_drive_named_offer.read(CARRY, backlog_drive.initial_state(['3'], ACTIVE), CONTEXT)

	expect(declared).toHaveBeenLastCalledWith([{ number: 1 }], process.cwd())
	expect(held).toHaveBeenCalledWith(1, DECLARED, process.cwd(), scope)
})

// The listing the hold reads (`labels` on the holder #3, outside the run), with #1 yielded on a plan
// that a declared #3 holds.
function hold_outside(labels: OpenIssueData['labels']): void {
	vi.spyOn(console, 'error').mockImplementation(vi.fn())
	vi.spyOn(lane_plan, 'is_yielded').mockImplementation((issue) => issue === 1)
	vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
		kind: 'read',
		issues: [{ ...RUNNING, labels }],
		cutoff: cutoff_of(1, LISTING_LIMIT, false),
	})
	vi.spyOn(backlog_plan_comment, 'declared_of').mockImplementation(
		async (pool) => await (pool.length === 0 ? new Map() : DECLARED),
	)
	vi.spyOn(lane_plan, 'is_yield_held').mockImplementation(
		(issue, declared) => issue === 1 && declared.has(RUNNING.number),
	)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(OPEN_STATE)
}

// joshuafolkken/kit#6800: the lane #1 yielded to runs outside the run, so nothing is in flight once
// `run:merge` books the yield — the run still holds #1 rather than relaunching it into the same yield.
test('holds a yielded named issue while its holder lane runs outside the run', async () => {
	hold_outside(RUNNING.labels)
	const harness = backlog_drive_fixture.harness({ finished: ['1'], yielded: ['1'] })

	const pass = await backlog_drive.run_pass(
		backlog_drive_fixture.state(['1']),
		true,
		named_ports(harness),
	)

	expect(pass).toMatchObject({ kind: 'continue', state: { in_flight: [] } })
	expect(harness.calls).toEqual(['merge 1'])
})

test('offers a yielded named issue again once its holder lane ends', async () => {
	hold_outside([])
	const harness = backlog_drive_fixture.harness({ finished: ['1'], yielded: ['1'] })

	const pass = await backlog_drive.run_pass(
		backlog_drive_fixture.state(['1']),
		true,
		named_ports(harness),
	)

	expect(pass).toMatchObject({ kind: 'continue', state: { in_flight: ['1'] } })
	expect(harness.calls).toEqual(['merge 1', 'launch 1'])
})

const ADDED_CARRY = { ...CARRY, done: [1, 2], added: [{ issue: 9, is_priority: false }] }

// The listing the hold reads, with the added #9 yielded on a plan the running #3 holds while `is_held`.
function hold_added(is_held: boolean): void {
	vi.spyOn(lane_plan, 'is_yielded').mockImplementation((issue) => issue === 9)
	vi.spyOn(auto_ok_cli, 'fetch_opted_in').mockResolvedValue({
		kind: 'read',
		issues: [RUNNING],
		cutoff: cutoff_of(1, LISTING_LIMIT, false),
	})
	vi.spyOn(backlog_plan_comment, 'declared_of').mockResolvedValue(DECLARED)
	vi.spyOn(lane_plan, 'is_yield_held').mockReturnValue(is_held)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(OPEN_STATE)
}

// joshuafolkken/kit#6883: every issue left was an added one the yield held, so the named side waited and
// the free lanes stayed empty. It names nothing now, and the pool's offer excludes the held one.
test('names nothing and excludes the held issue from the pool when only a yielded added one is left', async () => {
	hold_added(true)

	const { offer, pool } = await backlog_drive_named_offer.read(
		ADDED_CARRY,
		backlog_drive.initial_state(['3'], ACTIVE),
		CONTEXT,
	)

	expect(offer).toBeUndefined()
	expect(pool).toMatchObject({ in_flight: ['3'], exclude: ['3', '9'] })
})

// The holder runs outside the run, so nothing of the run's own is in flight: the pool would read the
// drain and end the run before the held issue is offered again.
test('waits on a yielded added issue held by a lane outside the run rather than asking the pool', async () => {
	hold_added(true)

	const { offer } = await backlog_drive_named_offer.read(
		ADDED_CARRY,
		backlog_drive.initial_state([], ACTIVE),
		CONTEXT,
	)

	expect(offer).toMatchObject({ verdict: 'wait', issues: [] })
})

test('runs an added issue whose yield hold ended before the pool is asked', async () => {
	hold_added(false)

	const { offer } = await backlog_drive_named_offer.read(
		ADDED_CARRY,
		backlog_drive.initial_state(['3'], ACTIVE),
		{ ...CONTEXT, forwarded: ['--max', '2'] },
	)

	expect(offer).toMatchObject({ verdict: 'run', issues: ['9'] })
})

test('reads no listing while no declared issue yielded', async () => {
	vi.spyOn(lane_plan, 'is_yielded').mockReturnValue(false)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue(OPEN_STATE)
	const fetch = vi.spyOn(auto_ok_cli, 'fetch_opted_in')
	const state = backlog_drive.initial_state(['3'], ACTIVE)
	const context = { ...CONTEXT, forwarded: ['--max', '2'] }

	await backlog_drive_named_offer.read(CARRY, state, context)

	expect(fetch).not.toHaveBeenCalled()
})
