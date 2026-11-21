import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_session_broker } from '#scripts/lane/lane-session-broker'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { review_brief_cli } from '#scripts/review/review-brief-cli'
import { review_interaction } from '#scripts/review/review-interaction'
import { review_pair } from '#scripts/review/review-pair'
import { review_prompt_level } from '#scripts/review/review-prompt-level'
import { review_round } from '#scripts/review/review-round'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'

// The briefs `josh run:review`'s open writes once its gate is green (`run-review-cli.ts`).

const INTERACTION_FLAG = '--interaction'
const SUCCESS_EXIT_CODE = 0
const { CODE, INTERACTION } = review_attest.REVIEW_SLOT

// The briefs an open writes: the slots this branch's issue owes round 1, and whether this is the ship's
// own `--code-only` open, which prints code's brief instead.
interface BriefPlan {
	is_code_only: boolean
	slots: ReadonlyArray<ReviewSlot>
}

const SLOT_ARGV: Readonly<Record<ReviewSlot, ReadonlyArray<string>>> = {
	code: [],
	interaction: [INTERACTION_FLAG],
}

// The slots this branch's issue owes round 1. A branch that names no issue, or the ship's own open,
// briefs code alone.
async function brief_slots(is_code_only: boolean): Promise<ReadonlyArray<ReviewSlot>> {
	if (is_code_only) return [CODE]
	const issue = git_branch.issue_from_branch(await git_command.branch())
	if (issue === undefined) return [CODE]
	const answer = await review_interaction.reading(issue)
	if (answer.inert_line !== undefined) process.stderr.write(`${answer.inert_line}\n`)

	return review_interaction.round_one_slots(answer.status)
}

// One slot's brief, written to the file `josh ship` hands that slot's reviewer, with only its path on
// stdout: the two briefs together exceed the Bash output cap, and a truncated brief sent the lane back
// to `review:brief`, whose new code nonce dropped the interaction slot (joshuafolkken/kit#4863). Its
// launch prompt follows, the one `josh ship` opens a reviewer with: the brief no longer travels in the
// prompt, and `/code-review` beside `review:attest` is how the time and cost readers tell a review.
// The slot's findings go with the old brief, read for a resume by then: a reviewer that ends without
// `review:submit` leaves `review:record --from-slot` nothing to record, not the last round's findings.
function save_brief(slot: ReviewSlot, text: string): void {
	const { brief, findings } = lane_session_broker.review_paths(PROJECT_ROOT, slot)

	stamp_file.write_text_stamp(brief, `${text}\n`)
	stamp_file.remove_stamp(findings)
	const opening =
		review_round.from_brief(text) === '2'
			? run_ship_review.final_opening(brief)
			: run_ship_review.round_one_opening(brief, review_prompt_level.round_one_trigger(slot))

	process.stdout.write(`${slot} brief: ${brief}\n${slot} prompt: ${opening}\n`)
	const paired = slot === CODE ? review_pair.offer(text) : undefined
	if (paired !== undefined) process.stdout.write(`${paired}\n`)
}

async function write_brief(slot: ReviewSlot): Promise<number> {
	const texts: Array<string> = []
	const code = await review_brief_cli.run_to(SLOT_ARGV[slot], (text) => {
		texts.push(text)
	})

	if (code === SUCCESS_EXIT_CODE) save_brief(slot, texts.join('\n'))

	return code
}

// Code's brief, then the interaction brief — never after a code brief that refused. `--code-only`, the
// ship's own open, prints code's brief: the ship reads it off stdout and writes that file itself.
async function open_briefs(plan: BriefPlan): Promise<number> {
	if (plan.is_code_only) return await review_brief_cli.run([])
	const code = await write_brief(CODE)

	if (code !== SUCCESS_EXIT_CODE || !plan.slots.includes(INTERACTION)) return code

	return await write_brief(INTERACTION)
}

const run_review_briefs = {
	brief_slots,
	open_briefs,
}

export { run_review_briefs, type BriefPlan }
