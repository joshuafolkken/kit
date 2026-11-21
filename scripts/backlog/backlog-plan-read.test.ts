import { launch_timing } from '#scripts/lane/launch-timing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PoolContext } from './backlog-gate-scope'
import type { Plan } from './backlog-plan-read'

const issue_list_recent_mock = vi.hoisted(() => vi.fn())
const fetch_opted_in_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: { issue_list_recent: issue_list_recent_mock },
}))
vi.mock('#scripts/auto-ok/auto-ok-cli', () => ({
	auto_ok_cli: { LISTING_LIMIT: 200, fetch_opted_in: fetch_opted_in_mock },
}))

const { backlog_plan_read } = await import('./backlog-plan-read')
const { backlog_next } = await import('./backlog-next')
const { backlog_gate_scope } = await import('./backlog-gate-scope')
const { lane_capacity } = await import('#scripts/lane/lane-capacity')

// joshuafolkken/kit#3430: the reads `backlog:plan` and `run:board` share — one open listing, and a
// cut listing that switches the blocker filter off rather than claiming an unread issue is closed.

const REPO = 'joshuafolkken/kit'
const ROWS = [
	{ number: 1, title: 'One', createdAt: '2026-10-01T00:00:00Z' },
	{ number: 2, title: 'Two', createdAt: '2026-10-02T00:00:00Z' },
]

function plan_stub(): Plan {
	const result: Plan['result'] = {
		verdict: 'wait',
		candidates: [],
		waiting: [],
		blocked_on_people: [],
		anomalies: [],
	}
	const scope = { standalone: new Set<string>(), declared: new Map() }

	return { result, repo: REPO, exclude: [], tracked: new Map(), scope }
}

const OPTED_IN: PoolContext['opted_in'] = { kind: 'read', issues: [], cutoff: 'none' }

function context_stub(): PoolContext {
	return {
		opted_in: OPTED_IN,
		tracking: { kind: 'read', index: new Map(), cutoff: 'none' },
		repo: REPO,
		exclude: [],
		implement_rate: undefined,
	}
}

// The classification's reads, answering `result` from the resolution.
function stub_classification(result: Plan['result'] | undefined): void {
	vi.spyOn(backlog_next, 'context_of').mockResolvedValue(context_stub())
	vi.spyOn(backlog_next, 'resolve').mockResolvedValue(result)
	vi.spyOn(backlog_gate_scope, 'gate_scope').mockResolvedValue(plan_stub().scope)
}

function stub_listing(): void {
	issue_list_recent_mock.mockResolvedValue({ json: JSON.stringify(ROWS), is_capped: false })
}

beforeEach(() => {
	issue_list_recent_mock.mockReset()
	fetch_opted_in_mock.mockReset()
	launch_timing.clear()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('backlog_plan_read.fetch_open', () => {
	it('reads the open listing with whether it was cut', async () => {
		issue_list_recent_mock.mockResolvedValue({ json: JSON.stringify(ROWS), is_capped: true })

		const listing = await backlog_plan_read.fetch_open()

		expect(listing?.rows.map((row) => row.number)).toStrictEqual([1, 2])
		expect(listing?.is_capped).toBe(true)
	})

	it('answers nothing when the listing could not be read', async () => {
		issue_list_recent_mock.mockResolvedValue({ json: undefined, is_capped: false })

		await expect(backlog_plan_read.fetch_open()).resolves.toBeUndefined()
	})

	// joshuafolkken/kit#8507: the reason reaches `run:board`'s notice slot.
	it('carries gh’s reason when the listing could not be read', async () => {
		issue_list_recent_mock.mockResolvedValue({
			json: undefined,
			is_capped: false,
			error: 'HTTP 401',
		})

		await expect(backlog_plan_read.read_open()).resolves.toStrictEqual({
			listing: undefined,
			error: 'HTTP 401',
		})
	})

	it('carries no reason for a listing read but not parsed', async () => {
		issue_list_recent_mock.mockResolvedValue({ json: '{}', is_capped: false })

		await expect(backlog_plan_read.read_open()).resolves.toStrictEqual({ listing: undefined })
	})
})

describe('backlog_plan_read.context_of', () => {
	it('keeps the open numbers from a whole listing and drops them from a cut one', async () => {
		issue_list_recent_mock.mockResolvedValue({ json: JSON.stringify(ROWS), is_capped: false })

		const listing = await backlog_plan_read.fetch_open()

		if (listing === undefined) throw new Error('listing unread')

		const whole = backlog_plan_read.context_of(plan_stub(), listing)
		const cut = backlog_plan_read.context_of(plan_stub(), { ...listing, is_capped: true })

		expect(whole.titles.get(2)).toBe('Two')
		expect(whole.open_numbers).toStrictEqual(new Set([1, 2]))
		expect(cut.open_numbers).toBeUndefined()
	})
})

// joshuafolkken/kit#8218: `run:board --timing` times each step of the classification; timing only
// records, so `backlog:plan` and `backlog:next` read the same plan.
describe('backlog_plan_read.classify timing', () => {
	const WAVE_LIMIT = 4
	const STEPS = ['plan: context', 'plan: resolve', 'plan: gate scope', 'plan: wave limit']

	it('answers the plan the classification reads, each step recorded as a plan phase', async () => {
		const stub = plan_stub()

		stub_classification(stub.result)
		vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: WAVE_LIMIT })
		const plan = await backlog_plan_read.classify(OPTED_IN, [])

		expect(plan).toStrictEqual({
			...stub,
			epics: new Map(),
			scope: { ...stub.scope, wave_limit: lane_capacity.seated_limit(WAVE_LIMIT) },
		})
		expect(launch_timing.phases().map(({ name }) => name)).toStrictEqual(STEPS)
		expect(backlog_gate_scope.gate_scope).toHaveBeenCalledOnce()
	})

	// joshuafolkken/kit#8220: the gate scope runs beside the resolution, never in place of its failure.
	it('answers nothing when the resolution fails, though the gate scope ran beside it', async () => {
		stub_classification(undefined)

		await expect(backlog_plan_read.classify(OPTED_IN, [])).resolves.toBeUndefined()
		expect(backlog_gate_scope.gate_scope).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#8220: the pool and the listing are read side by side, the listing once, and handed to
// the classification so the epics are drawn from it rather than read again.
describe('backlog_plan_read.read_plan', () => {
	it('answers nothing when the opted-in read fails', async () => {
		fetch_opted_in_mock.mockResolvedValue({ kind: 'failed' })
		stub_listing()

		await expect(backlog_plan_read.read_plan()).resolves.toBeUndefined()
	})

	it('answers nothing when the listing read fails', async () => {
		fetch_opted_in_mock.mockResolvedValue(OPTED_IN)
		issue_list_recent_mock.mockResolvedValue({ json: undefined, is_capped: false })

		await expect(backlog_plan_read.read_plan()).resolves.toBeUndefined()
	})

	it('starts the listing while the opted-in read is still pending', () => {
		fetch_opted_in_mock.mockReturnValue(new Promise(() => undefined))
		stub_listing()
		void backlog_plan_read.read_plan()

		expect(issue_list_recent_mock).toHaveBeenCalledOnce()
	})

	it('reads the listing once and hands it to the classification with the plan', async () => {
		const stub = plan_stub()

		fetch_opted_in_mock.mockResolvedValue(OPTED_IN)
		stub_listing()
		stub_classification(stub.result)
		const read = await backlog_plan_read.read_plan()

		expect(issue_list_recent_mock).toHaveBeenCalledOnce()
		expect(backlog_next.context_of).toHaveBeenCalledWith(OPTED_IN, [], read?.listing)
		expect(read?.listing.rows.map((row) => row.number)).toStrictEqual([1, 2])
		expect(read?.plan.result).toStrictEqual(stub.result)
	})
})

describe('backlog_plan_read.read_plan — a failed classification', () => {
	it('answers nothing when the classification fails after both reads', async () => {
		fetch_opted_in_mock.mockResolvedValue(OPTED_IN)
		stub_listing()
		stub_classification(undefined)

		await expect(backlog_plan_read.read_plan()).resolves.toBeUndefined()
		expect(backlog_next.resolve).toHaveBeenCalledOnce()
	})
})
