import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_round } from './review-round'

const ROOT = '/review-6369'
const CHECKOUT = { root: ROOT, branch: '6369-lane', head: 'head' }
const FILE_A = 'a.ts'
const FILE_B = 'b.ts'
const TREE = { [FILE_A]: 'digest', [FILE_B]: 'other' }
const SNAPSHOT = { taken_at: '2026-11-01', files: TREE, base: 'base' }
const FINAL_ROUND = 2

describe('an explicit full-change final round', () => {
	it.each([undefined, SNAPSHOT])(
		'reads the whole change regardless of snapshot: %j',
		(snapshot) => {
			const brief = review_brief.compose({
				level: 'medium',
				round: FINAL_ROUND,
				is_full_change: true,
				tree: TREE,
				base: 'base',
				checkout: CHECKOUT,
				nonce: 'nonce',
				rubric_path: '/rubric',
				stamps: { gate: undefined, in_flight: undefined, round_one: snapshot },
				resumed_from: SNAPSHOT,
			})

			expect(brief).toContain(review_round.FINAL_LINE)
			expect(brief).toContain('Target: the whole change')
			expect(brief).not.toContain('fix delta is empty')
			expect(brief).not.toContain('deliberately out of scope')
		},
	)
})

describe('review round selection', () => {
	it('keeps ordinary round arguments and rejects ambiguous full-change arguments', () => {
		expect(review_round.parse_round([])).toBe(1)
		expect(review_round.parse_round(['--round', '2'])).toBe(FINAL_ROUND)
		expect(review_round.parse_round([review_round.FULL_CHANGE_FLAG])).toBe(FINAL_ROUND)
		expect(
			review_round.parse_round(['--round', '1', review_round.FULL_CHANGE_FLAG]),
		).toBeUndefined()
	})

	it('uses the explicit brief round and preserves the caller round for ordinary briefs', () => {
		expect(review_round.from_brief(`medium\n${review_round.FINAL_LINE}`)).toBe('2')
		expect(review_round.from_brief('ordinary brief')).toBe('1')
		expect(review_round.from_brief('delta brief', '2')).toBe('2')
	})
})
