import { z } from 'zod'
import { parse_json_array_or_undefined } from './parse-json-array'

// GraphQL's `reviewDecision`, rebuilt from the review history REST serves.
//
// **REST has no field for it.** `repos/{owner}/{repo}/pulls/{N}/reviews` answers every review ever
// submitted, so the one value `gh pr view --json reviewDecision` gave has to be folded out of that
// listing (joshuafolkken/kit#1028).
//
// The only consumer is `is_review_blocked` in `git-pr-checks-eval.ts`, which asks one question: is
// `CHANGES_REQUESTED` standing? `APPROVED` and the empty string are therefore interchangeable to the
// merge gate, and both are produced anyway so the value stays readable next to what `gh` answered.
//
// One value cannot be reproduced and is not attempted: GraphQL answers `REVIEW_REQUIRED` when branch
// protection demands a review nobody has left, which is a repository setting rather than anything in
// this listing. The gate never distinguished it from the empty string, so nothing downstream moves.

const REVIEW_APPROVED = 'APPROVED'
const REVIEW_CHANGES_REQUESTED = 'CHANGES_REQUESTED'
// `gh` answered the empty string when no decision stood, and `read_string` in
// `git-pr-checks-parse.ts` folds it to `undefined` — the same answer a missing field would give.
const REVIEW_NONE = ''

// **Only these two change the decision.** `COMMENTED` leaves it untouched, which is not a corner
// case here: CodeRabbit posts its review as `COMMENTED` on every pull request this tooling opens, so
// counting it would make each reviewer's last review a comment and lose a standing change request.
// `PENDING` is a draft that was never submitted. `DISMISSED` is excluded for a subtler reason —
// GitHub rewrites the *original* review's state to `DISMISSED` rather than appending a record, so
// skipping it leaves the reviewer's last surviving verdict standing. A dismissed approval
// therefore falls back to an earlier change request (blocked, matching GitHub), where treating
// `DISMISSED` as a reset would open the gate — the one direction this file must never be wrong in.
const STATE_CHANGING_REVIEWS = new Set([REVIEW_APPROVED, REVIEW_CHANGES_REQUESTED])

const rest_review_schema = z.looseObject({
	state: z.string().optional(),
	user: z.looseObject({ login: z.string().optional() }).nullish(),
})

type RestReview = z.infer<typeof rest_review_schema>

const NOT_A_REVIEW_LISTING = 'gh api answered something other than a review listing'

// A listing that will not parse throws rather than answering "nobody requested changes" — the
// merge-gate direction of joshuafolkken/kit#973 again.
function parse_rest_reviews(reviews_json: string): Array<RestReview> {
	const parsed = parse_json_array_or_undefined(reviews_json, rest_review_schema)
	if (parsed === undefined) throw new Error(NOT_A_REVIEW_LISTING)

	return parsed
}

// A review with no author still counts. GitHub serves `user: null` for a review left by an account
// that has since been deleted, and dropping it would take a standing `CHANGES_REQUESTED` out of the
// decision — the one direction this file must never be wrong in. The sentinel cannot collide with a
// real login (GitHub logins hold no spaces or parentheses), so an unattributable review folds with
// the other unattributable ones and never overwrites a named reviewer's verdict.
const UNATTRIBUTED_REVIEWER = '(no author)'

function read_reviewer(review: RestReview): string {
	const login = review.user?.login

	return typeof login === 'string' && login.length > 0 ? login : UNATTRIBUTED_REVIEWER
}

function read_state_changing(review: RestReview): string | undefined {
	const state = review.state?.toUpperCase()

	return state !== undefined && STATE_CHANGING_REVIEWS.has(state) ? state : undefined
}

// The listing is chronological, so a later entry overwrites the same reviewer's earlier one and the
// map ends holding each reviewer's latest verdict. This is what keeps a reviewer who requested
// changes and then approved from leaving the pull request blocked.
function fold_latest_states(reviews: ReadonlyArray<RestReview>): Map<string, string> {
	const latest = new Map<string, string>()

	for (const review of reviews) {
		const state = read_state_changing(review)
		if (state !== undefined) latest.set(read_reviewer(review), state)
	}

	return latest
}

function to_review_decision(reviews_json: string): string {
	const latest = new Set(fold_latest_states(parse_rest_reviews(reviews_json)).values())

	if (latest.has(REVIEW_CHANGES_REQUESTED)) return REVIEW_CHANGES_REQUESTED

	return latest.has(REVIEW_APPROVED) ? REVIEW_APPROVED : REVIEW_NONE
}

const git_gh_pr_review = { to_review_decision, parse_rest_reviews }

export type { RestReview }
export {
	git_gh_pr_review,
	to_review_decision,
	NOT_A_REVIEW_LISTING,
	UNATTRIBUTED_REVIEWER,
	REVIEW_APPROVED,
	REVIEW_CHANGES_REQUESTED,
	REVIEW_NONE,
}
