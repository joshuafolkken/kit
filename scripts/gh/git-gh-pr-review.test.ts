import { describe, expect, it } from 'vitest'
import {
	git_gh_pr_review,
	NOT_A_REVIEW_LISTING,
	REVIEW_APPROVED,
	REVIEW_CHANGES_REQUESTED,
	REVIEW_NONE,
} from './git-gh-pr-review'
import { evaluate_pr_state } from './git-pr-checks-eval'
import { parse_pr_state_snapshot } from './git-pr-checks-parse'

// REST has no `reviewDecision`, so it is folded out of the full review history. The only consumer is
// `is_review_blocked`, which asks whether `CHANGES_REQUESTED` is standing — so every assertion here
// is ultimately about that one question (joshuafolkken/kit#1028).

const ALICE = 'alice'
const BOB = 'bob'
const CODE_RABBIT = 'coderabbitai[bot]'

function reviews(...rows: ReadonlyArray<{ login: string; state: string }>): string {
	return JSON.stringify(rows.map((row) => ({ state: row.state, user: { login: row.login } })))
}

function decide(...rows: ReadonlyArray<{ login: string; state: string }>): string {
	return git_gh_pr_review.to_review_decision(reviews(...rows))
}

describe('to_review_decision', () => {
	it('answers the empty string when nobody has reviewed', () => {
		expect(git_gh_pr_review.to_review_decision('[]')).toBe(REVIEW_NONE)
	})

	it('answers CHANGES_REQUESTED for a standing change request', () => {
		expect(decide({ login: ALICE, state: REVIEW_CHANGES_REQUESTED })).toBe(REVIEW_CHANGES_REQUESTED)
	})

	it('answers APPROVED when the only verdict is an approval', () => {
		expect(decide({ login: ALICE, state: REVIEW_APPROVED })).toBe(REVIEW_APPROVED)
	})
})

// `/reviews` returns the whole history, so a naive scan leaves a change request standing forever.
describe('to_review_decision — one reviewer, folded to their latest verdict', () => {
	it('reads CHANGES_REQUESTED then APPROVED as approved', () => {
		expect(
			decide(
				{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
				{ login: ALICE, state: REVIEW_APPROVED },
			),
		).toBe(REVIEW_APPROVED)
	})

	it('reads APPROVED then CHANGES_REQUESTED as blocked', () => {
		expect(
			decide(
				{ login: ALICE, state: REVIEW_APPROVED },
				{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
			),
		).toBe(REVIEW_CHANGES_REQUESTED)
	})

	// Folding is *per reviewer*: one reviewer's approval must not clear another's change request.
	it('keeps another reviewer’s change request standing', () => {
		expect(
			decide(
				{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
				{ login: BOB, state: REVIEW_APPROVED },
			),
		).toBe(REVIEW_CHANGES_REQUESTED)
	})
})

// COMMENTED is not a corner case here: CodeRabbit posts its review as COMMENTED on every pull
// request this tooling opens, so counting it would bury a standing change request under a comment.
describe('to_review_decision — states that do not change the decision', () => {
	it('ignores a COMMENTED review on its own', () => {
		expect(decide({ login: CODE_RABBIT, state: 'COMMENTED' })).toBe(REVIEW_NONE)
	})

	it('does not let a later COMMENTED clear a standing change request', () => {
		expect(
			decide(
				{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
				{ login: ALICE, state: 'COMMENTED' },
			),
		).toBe(REVIEW_CHANGES_REQUESTED)
	})

	it('ignores a PENDING draft that was never submitted', () => {
		expect(decide({ login: ALICE, state: 'PENDING' })).toBe(REVIEW_NONE)
	})

	// GitHub rewrites the original review's state to DISMISSED rather than appending a record, so
	// skipping it leaves the reviewer's last surviving verdict standing. A dismissed approval
	// therefore falls back to the earlier change request — blocked, which is the safe direction.
	it('falls back to an earlier change request when a later approval was dismissed', () => {
		expect(
			decide(
				{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
				{ login: ALICE, state: 'DISMISSED' },
			),
		).toBe(REVIEW_CHANGES_REQUESTED)
	})

	it('leaves nothing standing when the only review was dismissed', () => {
		expect(decide({ login: ALICE, state: 'DISMISSED' })).toBe(REVIEW_NONE)
	})
})

describe('to_review_decision — malformed input', () => {
	// "Nobody requested changes" is the answer that merges, so an unreadable listing must not produce
	// it (joshuafolkken/kit#973).
	it('throws when the response is not a listing', () => {
		expect(() => git_gh_pr_review.to_review_decision('{"message":"Not Found"}')).toThrow(
			NOT_A_REVIEW_LISTING,
		)
	})

	// A review with no author still counts. GitHub serves `user: null` for an account that has since
	// been deleted, and dropping such a review would take a standing change request out of the
	// decision — the one direction this file must never be wrong in. Written as raw JSON because that
	// null is what REST actually sends.
	it('keeps an unattributable change request standing', () => {
		const listing = '[{"state":"CHANGES_REQUESTED","user":null}]'

		expect(git_gh_pr_review.to_review_decision(listing)).toBe(REVIEW_CHANGES_REQUESTED)
	})

	// The sentinel it folds under cannot collide with a real login, so an unattributable review never
	// overwrites a named reviewer's verdict.
	it('does not let an unattributable review clear a named reviewer’s change request', () => {
		const listing = `[{"state":"CHANGES_REQUESTED","user":{"login":"${ALICE}"}},{"state":"APPROVED","user":null}]`

		expect(git_gh_pr_review.to_review_decision(listing)).toBe(REVIEW_CHANGES_REQUESTED)
	})
})

// The end-to-end shape the fold exists for: what the merge gate does with the value.
function evaluate(decision: string): string {
	return evaluate_pr_state(
		parse_pr_state_snapshot(
			JSON.stringify({
				statusCheckRollup: [],
				mergeStateStatus: 'CLEAN',
				reviewDecision: decision,
			}),
		),
	)
}

describe('to_review_decision — what the merge gate reads', () => {
	it('fails the gate on a standing change request', () => {
		expect(evaluate(decide({ login: ALICE, state: REVIEW_CHANGES_REQUESTED }))).toBe('failure')
	})

	it('does not fail the gate once that reviewer approves', () => {
		const decision = decide(
			{ login: ALICE, state: REVIEW_CHANGES_REQUESTED },
			{ login: ALICE, state: REVIEW_APPROVED },
		)

		expect(evaluate(decision)).not.toBe('failure')
	})
})
