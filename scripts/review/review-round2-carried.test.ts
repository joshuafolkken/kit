import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_round2 } from './review-round2'

// joshuafolkken/kit#4165: a moved base used to answer `required` outright. Round 1's tree carried onto
// the new base now names the fix delta, and the same empty / inert / live rules decide from it; only a
// carry that cannot be made keeps the old refusal.

const TAKEN_AT = '2026-10-20T00:00:00.000Z'
const ROUND_ONE_BASE = '0123456789abcdef0123456789abcdef01234567'
const MOVED_BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const SOURCE = 'src/thing.ts'
const BLOBS = { [SOURCE]: '89abcdef0123456789abcdef0123456789abcdef' }
const DOCUMENT = 'docs/maintainers/review-history.md'
const FROM_MAIN = 'src/from-main.ts'

const SNAPSHOT: FileMapStamp = {
	taken_at: TAKEN_AT,
	files: { [SOURCE]: 'aaa' },
	base: ROUND_ONE_BASE,
	blobs: BLOBS,
}

function decide_carried(
	carried: ReadonlyArray<string> | undefined,
): ReturnType<typeof review_round2.decide> {
	return review_round2.decide({
		base: MOVED_BASE,
		carried_delta: () => carried,
		is_round_one_closed: true,
		snapshot: SNAPSHOT,
		tree: { [SOURCE]: 'aaa', [FROM_MAIN]: 'ccc' },
	})
}

describe('review_round2.decide — a moved base with round 1 carried onto it', () => {
	it('skips the round as empty when the carried tree matches the tree now', () => {
		const decision = decide_carried([])

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.code).toBe(review_round2.CODE.EMPTY)
		expect(decision.delta).toStrictEqual([])
	})

	it('skips the round as inert when the carried delta is documentation only', () => {
		const decision = decide_carried([DOCUMENT])

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.code).toBe(review_round2.CODE.INERT)
		expect(decision.delta).toStrictEqual([DOCUMENT])
	})

	it('requires the round as live when the carried delta holds code', () => {
		const decision = decide_carried([SOURCE])

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.code).toBe(review_round2.CODE.LIVE)
	})

	it('requires the round as base-moved when the carry cannot be made', () => {
		const decision = decide_carried(undefined)

		expect(decision.code).toBe(review_round2.CODE.BASE_MOVED)
		expect(decision.reason).toBe(review_round2.BASE_MOVED_REASON)
	})
})

describe('review_round2.decide — when the carry is asked', () => {
	it('hands the carry the snapshot it was asked about', () => {
		const seen: Array<FileMapStamp['blobs']> = []

		review_round2.decide({
			base: MOVED_BASE,
			carried_delta: (snapshot) => {
				seen.push(snapshot.blobs)

				return []
			},
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: {},
		})

		expect(seen).toStrictEqual([BLOBS])
	})

	it('never asks for the carry when the base did not move', () => {
		const decision = review_round2.decide({
			base: ROUND_ONE_BASE,
			carried_delta: () => {
				throw new Error('asked for a carry on an unmoved base')
			},
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: { [SOURCE]: 'aaa' },
		})

		expect(decision.code).toBe(review_round2.CODE.EMPTY)
	})
})
