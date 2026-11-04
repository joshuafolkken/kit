import { beforeEach, expect, it, vi } from 'vitest'
import { lane_breakdown_estimate } from './lane-breakdown-estimate'

const mocks = vi.hoisted(() => ({ read: vi.fn(), closing: vi.fn() }))

vi.mock('./historical-evidence', () => ({ historical_evidence: { read: mocks.read } }))
vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_number_result: mocks.closing },
}))

const ISSUE = 6302
const START = '2026-11-04T11:00:00Z'
const END = '2026-11-04T12:00:00Z'
const PINNED_LOG = 'pinned.log:1'
const PRE_DETACH_TEXT = '#6302 pre-detach start'
const SHIP_STAGE = 'ship-stage'

beforeEach(() => {
	vi.resetAllMocks()
	vi.spyOn(console, 'error').mockReturnValue(undefined)
	mocks.closing.mockResolvedValue({ kind: 'read', number: undefined })
	mocks.read.mockResolvedValue({ evidence: [], unreadable: [] })
})

it('rejects reversed measured boundaries without reconstructing them', async () => {
	const entries = [
		{ kind: 'dispatch', at: END, issue: ISSUE },
		{ kind: 'merge', at: START, issue: ISSUE },
	] as const

	await expect(lane_breakdown_estimate.read(entries, [], ISSUE)).resolves.toBeUndefined()
	expect(mocks.read).not.toHaveBeenCalled()
})

it('keeps measured stage events instead of estimating the same stage (ac-4b1b2d87)', async () => {
	const events = [{ pos: 1, at: START, kind: 'plan', text: '#6302 plan' }] as const

	mocks.read.mockResolvedValue({
		evidence: [
			{ kind: 'plan', at: START, source: 'comment' },
			{ kind: 'pinned', at: START, source: PINNED_LOG },
			{ kind: 'merge', at: END, source: 'pull' },
		],
		unreadable: [],
	})

	const result = await lane_breakdown_estimate.read([], events, ISSUE)

	expect(result?.events.filter((event) => event.kind === 'plan')).toEqual(events)
	expect(result?.events).toContainEqual({
		pos: 0,
		at: START,
		kind: SHIP_STAGE,
		text: PRE_DETACH_TEXT,
	})
})

it('does not use a commit or review as proof of completion', async () => {
	mocks.read.mockResolvedValue({
		evidence: [
			{ kind: 'plan', at: START, source: 'comment' },
			{ kind: 'review-record', at: END, source: 'review' },
		],
		unreadable: [],
	})

	await expect(lane_breakdown_estimate.read([], [], ISSUE)).resolves.toBeUndefined()
})

it.each([
	{ kind: 'plan', text: '#6302 plan ready' },
	{ kind: 'lane-phase', text: '#6302 implement' },
])('prioritizes measured planning with different text: $kind', async (event) => {
	const measured = { ...event, pos: 1, at: START }

	mocks.read.mockResolvedValue({
		evidence: [
			{ kind: 'plan', at: START, source: 'comment' },
			{ kind: 'merge', at: END, source: 'pull' },
		],
		unreadable: [],
	})

	const result = await lane_breakdown_estimate.read([], [measured], ISSUE)

	expect(result?.events).toEqual([measured])
})

it('uses the first log marker once and honors measured ship stages', async () => {
	const measured = { pos: 1, at: END, kind: SHIP_STAGE, text: '#6302 review start | measured' }

	mocks.read.mockResolvedValue({
		evidence: [
			{ kind: 'plan', at: START, source: 'comment' },
			{ kind: 'pinned', at: START, source: PINNED_LOG },
			{ kind: 'pinned', at: END, source: 'pinned.log:2' },
			{ kind: 'ship-review', at: START, source: 'review.log:1' },
			{ kind: 'merge', at: END, source: 'pull' },
		],
		unreadable: [],
	})

	const result = await lane_breakdown_estimate.read([], [measured], ISSUE)

	expect(result?.events.filter((event) => event.text.includes('review'))).toEqual([measured])
	expect(result?.events.filter((event) => event.text.includes('pre-detach'))).toEqual([
		{ pos: 0, at: START, kind: SHIP_STAGE, text: PRE_DETACH_TEXT },
	])
})
