import type { LaneInfo } from '#scripts/lane/lane-registry'
import type { HoldRead, RunHold } from '#scripts/run/hold/run-hold'
import { describe, expect, it } from 'vitest'
import { lane_transition_guards, type GuardReaders } from './lane-transition-guards'

const ISSUE = '8777'
const OTHER = '8700'
const BRANCH = '8777-lane'

function lane_of(is_stranded: boolean): LaneInfo {
	const lane: LaneInfo = {
		issue: ISSUE,
		branch: BRANCH,
		directory: '/lanes/8777',
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
		is_stranded,
	}

	return lane
}

function hold_of(issue: string): RunHold {
	return { issue, taken_at: new Date().toISOString(), pid: 1 }
}

interface ReaderFacts {
	lane?: LaneInfo
	has_branch?: boolean
	hold?: HoldRead
}

function readers_of(facts: ReaderFacts): GuardReaders {
	return {
		find_lane: async () => await facts.lane,
		branch_exists: async () => await (facts.has_branch ?? true),
		read_tree_hold: async () => await (facts.hold ?? { kind: 'free' }),
	}
}

describe('lane_transition_guards.rejection — work-tree-present on resume / restart', () => {
	it.each(['resume', 'restart'] as const)(
		'rejects %s on a lane with no record of it',
		async (event) => {
			const reason = await lane_transition_guards.rejection(event, ISSUE, readers_of({}))

			expect(reason).toBe('it has no lane')
		},
	)

	it.each(['resume', 'restart'] as const)('rejects %s on a gone work tree', async (event) => {
		const readers = readers_of({ lane: lane_of(true) })

		expect(await lane_transition_guards.rejection(event, ISSUE, readers)).toBe(
			'its work tree is gone',
		)
	})

	it.each(['resume', 'restart'] as const)('rejects %s on a gone branch', async (event) => {
		const readers = readers_of({ lane: lane_of(false), has_branch: false })

		expect(await lane_transition_guards.rejection(event, ISSUE, readers)).toBe(
			`its branch ${BRANCH} is gone`,
		)
	})

	it('allows a resume where the branch and the work tree exist', async () => {
		const readers = readers_of({ lane: lane_of(false) })

		expect(await lane_transition_guards.rejection('resume', ISSUE, readers)).toBeUndefined()
	})
})

describe('lane_transition_guards.rejection — checkout-not-held-by-another-run on merge', () => {
	it('rejects a merge on a checkout another run holds', async () => {
		const readers = readers_of({ hold: { kind: 'held', hold: hold_of(OTHER) } })

		expect(await lane_transition_guards.rejection('merge', ISSUE, readers)).toMatch(
			new RegExp(`held by .*#${OTHER}`, 'u'),
		)
	})

	it('rejects a merge on an unreadable hold record', async () => {
		const readers = readers_of({ hold: { kind: 'unreadable' } })

		expect(await lane_transition_guards.rejection('merge', ISSUE, readers)).toBe(
			'its run hold record is unreadable',
		)
	})

	it.each<[string, HoldRead]>([
		['its own run', { kind: 'held', hold: hold_of(ISSUE) }],
		['no run', { kind: 'free' }],
	])('allows a merge on a checkout held by %s', async (_label, hold) => {
		const readers = readers_of({ hold })

		expect(await lane_transition_guards.rejection('merge', ISSUE, readers)).toBeUndefined()
	})
})

describe('lane_transition_guards.has_work_tree', () => {
	it('answers whether the lane is checked out on the given existing branch', () => {
		expect(lane_transition_guards.has_work_tree(lane_of(false), BRANCH)).toBe(true)
		expect(lane_transition_guards.has_work_tree(lane_of(false), `${OTHER}-other`)).toBe(false)
		expect(lane_transition_guards.has_work_tree(lane_of(true), BRANCH)).toBe(false)
		expect(lane_transition_guards.has_work_tree(undefined, BRANCH)).toBe(false)
	})
})
