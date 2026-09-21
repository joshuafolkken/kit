import { split_assess } from '#scripts/split/split-assess'
import { describe, expect, it } from 'vitest'
import { issue_fold } from './issue-fold'

// joshuafolkken/kit#2213: the fold verdict reads the split assessment's two questions in the same
// conjunction. `separate` needs both — separable and a size that clears the split guide — so every
// other combination folds, and fewer than two candidates is not a fold question at all.

const TWO_CANDIDATES = 2
const SPLIT = split_assess.SPLIT_VERDICT
const SINGLE = split_assess.SINGLE_VERDICT

describe('fold_verdict — the same two questions as the split assessment', () => {
	it('separates separable findings whose combined size clears the guide', () => {
		expect(issue_fold.fold_verdict(TWO_CANDIDATES, true, SPLIT)).toBe(issue_fold.SEPARATE)
	})

	it('folds separable findings whose size is under the guide', () => {
		expect(issue_fold.fold_verdict(TWO_CANDIDATES, true, SINGLE)).toBe(issue_fold.FOLD)
	})

	it('folds inseparable findings however large the size', () => {
		expect(issue_fold.fold_verdict(TWO_CANDIDATES, false, SPLIT)).toBe(issue_fold.FOLD)
	})

	it('answers no-fold-needed for a single candidate', () => {
		expect(issue_fold.fold_verdict(1, true, SPLIT)).toBe(issue_fold.NO_FOLD_NEEDED)
	})

	it('answers no-fold-needed for no candidate at all', () => {
		expect(issue_fold.fold_verdict(0, true, SPLIT)).toBe(issue_fold.NO_FOLD_NEEDED)
	})
})
