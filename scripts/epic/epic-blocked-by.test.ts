import { epic_index } from '#scripts/epic/epic-index'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { epic_blocked_by } from './epic-blocked-by'

// joshuafolkken/kit#5647: the blocked-by write `run:pause` and `backlog:triage --blocked-by` share.
// The relations and the calls land in an in-memory stand-in, so a rerun reads back the first run.

const state = vi.hoisted(() => ({
	blockers: [] as Array<number>,
	calls: [] as Array<string>,
	is_relation_failing: false,
}))

vi.mock('#scripts/gh/git-gh-issue-read', () => ({
	git_gh_issue_read: { issue_blocked_by_numbers: async () => [...state.blockers] },
}))

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_blocked_by: async (_issue: string, blocker: string) => {
			state.calls.push('relation')
			if (state.is_relation_failing) return false
			state.blockers.push(Number(blocker))

			return true
		},
	},
}))

const add_children = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-add', () => ({ epic_add: { add_children } }))

const reconcile_epic = vi.hoisted(() => vi.fn())

const refusal_after = vi.hoisted(() => vi.fn())

vi.mock('#scripts/epic/epic-reconcile', () => ({
	epic_reconcile: { reconcile_epic, refusal_after },
}))

const REQUEST = { issue: '10', prerequisite: '11' }
const EPIC = 7
const RECORDED_IN_EPIC = 'recorded in epic'
const BOTH_TRACKED = '- [ ] #10\n- [ ] #11'
const ISSUE_TRACKED = '- [ ] #10'
const UNSEEN = 'not read in full'

function epics_of(body: string): void {
	vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({
		cutoff: 'none',
		epics: [{ number: EPIC, body }],
	})
}

beforeEach(() => {
	Object.assign(state, { blockers: [], calls: [], is_relation_failing: false })
	vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({ cutoff: 'none', epics: [] })
	add_children.mockReset().mockImplementation(async () => {
		state.calls.push('epic')
		state.blockers.push(Number(REQUEST.prerequisite))

		return 0
	})
	reconcile_epic.mockReset().mockImplementation(async () => {
		state.calls.push('reconcile')

		return 0
	})
	refusal_after.mockReset().mockResolvedValue(undefined)
})

describe('epic_blocked_by.record — outside an epic', () => {
	it('records the relation directly when no epic tracks the issue', async () => {
		expect(await epic_blocked_by.record(REQUEST)).toBe('recorded')
		expect(state.blockers).toStrictEqual([11])
	})

	it('writes nothing on a rerun once the relation is recorded', async () => {
		state.blockers = [11]

		expect(await epic_blocked_by.record(REQUEST)).toBe('already')
		expect(state.calls).toStrictEqual([])
	})

	it('throws when the relation is not recorded', async () => {
		state.is_relation_failing = true

		await expect(epic_blocked_by.record(REQUEST)).rejects.toThrow('was not recorded')
	})

	it('throws on a cut-short epic listing rather than reading it as no epic', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({ cutoff: 'row_limit', epics: [] })

		await expect(epic_blocked_by.record(REQUEST)).rejects.toThrow(UNSEEN)
		expect(state.calls).toStrictEqual([])
	})
})

describe('epic_blocked_by.record — caused parks', () => {
	it('keeps a caused-park prerequisite out of two different source epics', async () => {
		const fetched = vi.spyOn(epic_index, 'fetch_epics')

		epics_of(ISSUE_TRACKED)
		await epic_blocked_by.record({ ...REQUEST, is_relation_only: true })
		state.blockers = []
		fetched.mockResolvedValue({ cutoff: 'none', epics: [{ number: 8, body: '- [ ] #12' }] })
		await epic_blocked_by.record({ ...REQUEST, issue: '12', is_relation_only: true })

		expect(add_children).not.toHaveBeenCalled()
		expect(state.calls).toStrictEqual(['relation', 'relation'])
	})

	it('declares a relation-only record when both ends are already in one epic', async () => {
		epics_of(BOTH_TRACKED)

		await epic_blocked_by.record({ ...REQUEST, is_relation_only: true })

		expect(state.calls).toStrictEqual(['relation', 'reconcile'])
	})
})

describe('epic_blocked_by.record — inside an epic', () => {
	it('adds an untracked prerequisite through `epic --add --before`', async () => {
		epics_of(ISSUE_TRACKED)

		expect(await epic_blocked_by.record(REQUEST)).toContain(RECORDED_IN_EPIC)
		expect(state.calls).toStrictEqual(['epic'])
		expect(add_children).toHaveBeenCalledWith({
			epic_number: EPIC,
			children: [11],
			position: { kind: 'before', target: 10 },
		})
	})

	it('records and reconciles a prerequisite the epic already tracks', async () => {
		epics_of(BOTH_TRACKED)

		expect(await epic_blocked_by.record(REQUEST)).toContain(RECORDED_IN_EPIC)
		expect(state.calls).toStrictEqual(['relation', 'reconcile'])
	})

	it('records nothing when the reconcile would refuse the relation', async () => {
		epics_of(BOTH_TRACKED)
		refusal_after.mockResolvedValue('a cycle')

		await expect(epic_blocked_by.record(REQUEST)).rejects.toThrow('a cycle')
		expect(state.calls).toStrictEqual([])
	})

	it('reconciles again on a rerun past a failed reconcile', async () => {
		epics_of(BOTH_TRACKED)
		state.blockers = [11]

		expect(await epic_blocked_by.record(REQUEST)).toBe('already')
		expect(state.calls).toStrictEqual(['reconcile'])
	})
})

describe('epic_blocked_by.listing_epics', () => {
	it('returns every epic listing the issue, not only the one the index keeps', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({
			cutoff: 'none',
			epics: [
				{ number: EPIC, body: ISSUE_TRACKED },
				{ number: 8, body: BOTH_TRACKED },
				{ number: 9, body: '- [ ] #11' },
			],
		})

		expect(await epic_blocked_by.listing_epics(REQUEST.issue)).toStrictEqual([EPIC, 8])
	})

	it('returns no epic when none lists the issue', async () => {
		expect(await epic_blocked_by.listing_epics(REQUEST.issue)).toStrictEqual([])
	})

	it('throws on a cut-short epic listing even when an epic lists the issue', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({
			cutoff: 'row_limit',
			epics: [{ number: EPIC, body: ISSUE_TRACKED }],
		})

		await expect(epic_blocked_by.listing_epics(REQUEST.issue)).rejects.toThrow(UNSEEN)
	})
})

// joshuafolkken/kit#5846: `run:split`'s placement — the epic tracking `#N`, and whether a rerun finds
// every child already placed in it.
describe('epic_blocked_by.tracking_with', () => {
	it('answers no epic when none tracks the issue', async () => {
		expect(await epic_blocked_by.tracking_with('10', ['11'])).toBeUndefined()
	})

	it.each([
		[BOTH_TRACKED, ['11'], true],
		[BOTH_TRACKED, ['11', '12'], false],
		[ISSUE_TRACKED, ['11'], false],
	])('reads %j with children %j as lists_children %s', async (body, children, lists_children) => {
		epics_of(body)

		expect(await epic_blocked_by.tracking_with('10', children)).toStrictEqual({
			epic: EPIC,
			lists_children,
		})
	})

	it('throws when the listing is cut short and no epic is seen', async () => {
		vi.spyOn(epic_index, 'fetch_epics').mockResolvedValue({ cutoff: 'row_limit', epics: [] })

		await expect(epic_blocked_by.tracking_with('10', ['11'])).rejects.toThrow(UNSEEN)
	})
})
