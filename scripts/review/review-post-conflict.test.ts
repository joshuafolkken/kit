import type { IssueComment } from '#scripts/issue/issue-read'
import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_resolve } from '#scripts/lane/lane-resolve'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { review_post_conflict } from './review-post-conflict'
import { review_prompt_level } from './review-prompt-level'

// joshuafolkken/kit#8494: a round 1 after a lane conflict resolution names `post-conflict` on its
// launches, judged off the resolution comments against the ledger's last round-one record.

const ISSUE = 8494
const OTHER_ISSUE = 8495
const BEFORE = '2026-11-01T00:00:00Z'
const AT = '2026-11-02T00:00:00Z'
const AFTER = '2026-11-03T00:00:00Z'

const resolutions = vi.spyOn(lane_resolve, 'resolutions')
const target = vi.spyOn(lane_ledger_write, 'target')
const read_entries = vi.spyOn(lane_ledger, 'read_entries')

function resolution(created_at: string): IssueComment {
	return {
		author: 'joshuafolkken',
		created_at,
		body: lane_resolve.RESOLUTION_HEADING,
		is_trusted: true,
	}
}

function round_one(issue: number): LedgerEntry {
	return { kind: 'round-one', at: AT, issue, verdict: 'clean' }
}

beforeEach(() => {
	target.mockResolvedValue('ledger.jsonl')
	read_entries.mockReturnValue([round_one(ISSUE)])
})

describe('review_post_conflict.is_post_conflict', () => {
	it.each([
		['a resolution after the last round 1', [resolution(AFTER)], true],
		['a resolution before the last round 1', [resolution(BEFORE)], false],
		['no resolution', [], false],
		['an unreadable comment thread', undefined, false],
	])('answers on %s', async (_case, found, expected) => {
		resolutions.mockResolvedValue(found)
		expect(await review_post_conflict.is_post_conflict(ISSUE)).toBe(expected)
	})

	it('counts any resolution when the Issue has no round-one record', async () => {
		const round_two: LedgerEntry = {
			kind: 'round-two',
			at: AFTER,
			issue: ISSUE,
			verdict: 'skip',
			code: 'held',
		}

		read_entries.mockReturnValue([round_one(OTHER_ISSUE), round_two])
		resolutions.mockResolvedValue([resolution(BEFORE)])
		expect(await review_post_conflict.is_post_conflict(ISSUE)).toBe(true)
	})

	it('answers no when a read throws', async () => {
		resolutions.mockRejectedValue(new Error('gh failed'))
		expect(await review_post_conflict.is_post_conflict(ISSUE)).toBe(false)
	})
})

describe('review_post_conflict.trigger', () => {
	it.each([
		[[resolution(AFTER)], true, review_prompt_level.RETRY.POST_CONFLICT],
		[[], true, review_prompt_level.RETRY.STALE],
		[[], false, undefined],
	])('answers on resolutions %j and stale %s', async (found, is_stale, expected) => {
		resolutions.mockResolvedValue(found)
		expect(await review_post_conflict.trigger(ISSUE, is_stale)).toBe(expected)
	})
})
