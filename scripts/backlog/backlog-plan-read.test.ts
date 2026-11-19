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

	function arrange(): Plan {
		const stub = plan_stub()
		const context: PoolContext = {
			opted_in: { kind: 'read', issues: [], cutoff: 'none' },
			tracking: { kind: 'read', index: new Map(), cutoff: 'none' },
			repo: REPO,
			exclude: [],
			implement_rate: undefined,
		}

		vi.spyOn(backlog_next, 'context_of').mockResolvedValue(context)
		vi.spyOn(backlog_next, 'resolve').mockResolvedValue(stub.result)
		vi.spyOn(backlog_gate_scope, 'gate_scope').mockResolvedValue(stub.scope)
		vi.spyOn(lane_capacity, 'lane_limit').mockResolvedValue({ kind: 'limit', limit: WAVE_LIMIT })

		return stub
	}

	it('answers the plan the classification reads, each step recorded as a plan phase', async () => {
		const stub = arrange()
		const plan = await backlog_plan_read.classify({ kind: 'read', issues: [], cutoff: 'none' }, [])

		expect(plan).toStrictEqual({
			...stub,
			epics: new Map(),
			scope: { ...stub.scope, wave_limit: lane_capacity.seated_limit(WAVE_LIMIT) },
		})
		expect(launch_timing.phases().map(({ name }) => name)).toStrictEqual(STEPS)
	})
})

describe('backlog_plan_read.read_plan', () => {
	it('answers nothing without reading the listing when the opted-in read fails', async () => {
		fetch_opted_in_mock.mockResolvedValue({ kind: 'failed' })

		await expect(backlog_plan_read.read_plan()).resolves.toBeUndefined()
		expect(issue_list_recent_mock).not.toHaveBeenCalled()
	})
})
