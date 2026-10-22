import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { review_attest } from '#scripts/review/review-attest'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_record } from '#scripts/review/review-record'

// The merge gates over the review rounds — that the review read its own checkout, and that each round
// the change owes left its ledger line. `git-followup-workflow.ts` runs them first, before the gates over
// the pull request body.

// `/code-review` is forked by the harness and inherits the *session's* working directory, so a run
// implementing in a lane can be reviewed against a different tree entirely — one holding the
// previous child's already-merged code. That review finds nothing wrong and says so, and the run
// would read the silence as a clean round. **This is the seam where that is caught**: a merge is
// refused unless the review attested the checkout it was briefed on.
//
// **Absence is a refusal, not a pass.** The defect produces *no* signal, so a check that only
// compared two present records would answer `ok` in exactly the state it exists to catch.
//
// **Scoped to a checkout that actually briefed a review.** `review_attest.check` answers
// `not-required` where no `josh review:brief` was run here inside a run's lifetime, so a project or
// a flow that does not use the brief merges exactly as it did before.
//
// The direction is deliberate: a wrongly-refused merge costs one re-run of the review, and a wrongly
// allowed one ships a diff nobody read. Thrown rather than reported, so no `completion` Telegram is
// sent and nothing merges — `git_pr_followup.run` is never reached.
// `ok` means the guard was satisfied and `not-required` means it never applied to this checkout —
// both let the merge proceed, so the two gates below read the verdict through one predicate rather
// than repeating the pair of statuses.
function is_merge_permitted(status: string): boolean {
	return status === 'ok' || status === 'not-required'
}

function is_valid_issue(issue_number: string | undefined): issue_number is string {
	return issue_number !== undefined && issue_number_shape.ISSUE_NUMBER_PATTERN.test(issue_number)
}

async function assert_review_attested(should_merge: boolean): Promise<void> {
	if (!should_merge) return

	const verdict = await review_attest.check_here()

	if (!is_merge_permitted(verdict.status)) throw new Error(review_attest.refusal_message(verdict))

	const refusal = await issue_watch_gate.review_refusal_here()

	if (refusal !== undefined) throw new Error(refusal)
}

// Recording a review round as a prose request leaves the recurrence ledger blind whenever it is
// skipped. **This is the seam where it is a gate instead**: a merge is refused unless the round left
// a `- rf:` line for its issue, a zero-finding `none` line included — and, for a change to the run
// tooling, unless the interaction review left its `- ri:` line too (joshuafolkken/kit#4276).
//
// **Absence is a refusal, `missing` exactly as `assert_review_attested`'s is** — the defect this
// exists for produces *no* line, so silence must not read as success. A checkout that keeps no ledger
// answers `not-required` and merges as before, and a run whose issue the followup cannot identify has
// no key to check, so it carries on rather than blocking on missing information.
async function assert_review_recorded(
	should_merge: boolean,
	issue_number: string | undefined,
): Promise<void> {
	if (!should_merge || !is_valid_issue(issue_number)) return

	const issue = Number(issue_number)
	const verdict = await review_record.check(issue)

	if (!is_merge_permitted(verdict.status)) throw new Error(review_record.refusal_message(issue))

	const refusal = await review_interaction.refusal(issue)

	if (refusal !== undefined) throw new Error(refusal)
}

const followup_review_gates = {
	assert_review_attested,
	assert_review_recorded,
	is_valid_issue,
}

export { followup_review_gates }
