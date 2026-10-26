import { git_command } from '#scripts/git/git-command'
import { review_attest } from '#scripts/review/review-attest'
import { review_prior_findings } from '#scripts/review/review-prior-findings'
import { review_record } from '#scripts/review/review-record'
import { run_cut, type RunCut } from './run-cut'
import { run_cut_digest } from './run-cut-digest'
import { run_cut_handoff, type Handoff } from './run-cut-handoff'

// The review round an implementation cut has to carry across the process boundary
// (joshuafolkken/kit#4868). A lane child's in-session reviewer returns its findings into the
// conversation, and `review:record` is run after the fixes — so a cut between the two dropped the
// findings with the conversation, and the resumed child reran round 1 in full. The cut is refused
// until the round is recorded or its findings ride in the handoff, and the resume prints a recorded
// round back so it is continued, not rerun.

function unrecorded_note(issue: string): string {
	return (
		'a review round is attested on this branch but not recorded, and the handoff carries no ' +
		`"findings" — run \`pnpm josh review:record --issue ${issue} [<finding> ...]\` before the cut, ` +
		'or list the round\'s findings under "findings" in the handoff, so the resumed run does not ' +
		'rerun round 1'
	)
}

const RECORDED_ROUND_HEADING =
	'Round 1 is recorded for this issue — do not rerun it; continue the fixes, then the ship, ' +
	'which reviews only what moved since:'

interface CutScope {
	issue: string
	branch: string
	phase: string
}

// Attested on this branch, with no `review:record` line for the issue — the round the cut would lose.
async function has_unrecorded_round(issue: string, branch: string): Promise<boolean> {
	const root = await git_command.repository_root()

	if (!review_attest.is_attested_on({ branch }, root)) return false

	const recorded = await review_record.check(Number(issue))

	return recorded.status === 'missing'
}

// Only an implementation cut without carried findings can lose a round: a pre-gate cut is taken
// before any review.
function may_drop_round(scope: CutScope, handoff: Handoff | undefined): boolean {
	if (!run_cut.resumes_into_implementation(scope.phase)) return false

	return run_cut_handoff.carried_findings(handoff).length === 0
}

// The note an implementation cut is refused with when it would drop an unrecorded round, else
// `undefined`.
async function unrecorded_refusal(
	scope: CutScope,
	handoff: Handoff | undefined,
): Promise<string | undefined> {
	if (!may_drop_round(scope, handoff)) return undefined

	const is_unrecorded = await has_unrecorded_round(scope.issue, scope.branch)

	return is_unrecorded ? unrecorded_note(scope.issue) : undefined
}

// What an implementation resume prints about a round recorded before the cut: the heading and the
// findings the stop log kept with their reasons; nothing when no round is recorded.
async function recorded_round_lines(issue: string): Promise<ReadonlyArray<string>> {
	const recorded = await review_record.check(Number(issue))

	if (recorded.status !== 'ok') return []

	const findings = review_prior_findings.latest(issue, () => true)

	return [RECORDED_ROUND_HEADING, ...findings.map((finding) => `  - ${finding}`)]
}

// The carried instruction and work state, printed to standard error so the resumed session continues
// on what the run was told to do rather than on the tree alone — and, for an implementation resume,
// the round recorded before the cut. The record is cleared on adoption, so this is where it reaches
// the fresh process.
async function announce_resume(cut_record: RunCut, is_implementation: boolean): Promise<void> {
	if (cut_record.handoff !== undefined) {
		console.error(run_cut_handoff.describe_handoff(cut_record.handoff))
	}

	const digest = run_cut_digest.describe_digest(cut_record.digest)

	if (digest !== undefined) console.error(digest)

	if (!is_implementation) return

	const lines = await recorded_round_lines(cut_record.issue)

	if (lines.length > 0) console.error(lines.join('\n'))
}

const run_cut_review = {
	RECORDED_ROUND_HEADING,
	announce_resume,
	unrecorded_refusal,
}

export { run_cut_review }
