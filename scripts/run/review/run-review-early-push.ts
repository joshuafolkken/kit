import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { josh_command } from '#scripts/josh/josh-run'
import { stamp_file } from '#scripts/josh/stamp-file'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { review_attest, type ReviewSlot } from '#scripts/review/review-attest'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_ship_body_draft } from '#scripts/run/ship/run-ship-body-draft'
import { run_review } from './run-review'
import { run_review_steps } from './run-review-steps'

// **A lane child's `josh run:review` pushes at the first green gate** (joshuafolkken/kit#4907), so the
// pull request's CI runs beside round 1 rather than after the ship's commit stage. The open commits the
// tree locally before the brief is minted — the attest compares `HEAD`, and the gate, brief and reuse
// records are keyed by the file map a no-change commit leaves alone — then leaves `josh run:review
// --push` waiting on the gate in the background. On a green gate over a clean tree it pushes and opens
// the pull request (CI triggers on `pull_request` only); a red or moved gate, or a tree a round-1 fix
// already moved, pushes nothing and the ship's commit stage pushes as before. A round recorded once
// the branch is pushed goes to the issue (`review-record-comment.ts`).
//
// Only a lane child's own open, briefing code alone: the ship's `--code-only` open commits through its
// own sync stage, and an interaction review is still to come.

const PUSH_FLAG = '--push'
const RUN_REVIEW_COMMAND = 'run:review'
const PUSH_LOG_PREFIX = 'josh-run-review-push-log-'
const COMMIT_ARGS = ['git', '-y', '--skip-push', '--skip-pr']
const PUSH_ARGS = ['git', '-y', '--skip-commit']
const SUCCESS_EXIT_CODE = 0
const COMMIT_REFUSED_NOTE =
	'The early commit was refused, so this round pushes nothing early; `josh ship` commits and pushes as before:'
const SKIPPED_NOTE = 'No early push: '
const RED_NOTE = 'the gate did not come back green on this tree.'
const DIRTY_NOTE = 'the tree moved after the gate (a round-1 fix in place).'

interface EarlyPushPlan {
	is_code_only: boolean
	slots: ReadonlyArray<ReviewSlot>
}

type Environment = Readonly<Record<string, string | undefined>>

function is_code_alone(plan: EarlyPushPlan): boolean {
	if (plan.is_code_only) return false

	return plan.slots.length === 1 && plan.slots[0] === review_attest.REVIEW_SLOT.CODE
}

// The mark counts only in the checkout of the issue it names: a leaked one pushes nothing.
function is_due(
	plan: EarlyPushPlan,
	environment: Environment = process.env,
	directory = PROJECT_ROOT,
): boolean {
	return lane_child_marker.is_child_of(directory, environment) && is_code_alone(plan)
}

// A clean tree is already committed; a refused commit says why and leaves the round to the ship.
async function commit_locally(): Promise<boolean> {
	if (!(await run_hold.is_tree_dirty())) return true
	const result = await josh_command.josh_run(COMMIT_ARGS)

	if (result.code === SUCCESS_EXIT_CODE) return true
	process.stderr.write(`${COMMIT_REFUSED_NOTE}\n${result.out}\n${result.err ?? ''}\n`)

	return false
}

// Whether this open pushes early: due here, and the tree committed for the brief to attest.
async function prepare(
	plan: EarlyPushPlan,
	environment?: Environment,
	directory?: string,
): Promise<boolean> {
	return is_due(plan, environment, directory) && (await commit_locally())
}

function launch(): void {
	const log_path = stamp_file.stamp_path(PUSH_LOG_PREFIX, PROJECT_ROOT)
	const result = run_review_steps.launch_josh([RUN_REVIEW_COMMAND, PUSH_FLAG], log_path)

	if (result.kind === 'failed') {
		process.stderr.write(`${SKIPPED_NOTE}the push could not be started: ${result.note}\n`)
	}
}

async function skip_reason(): Promise<string | undefined> {
	if ((await run_review_steps.wait_for_gate_finish()) !== run_review.GATE_GREEN) return RED_NOTE

	return (await run_hold.is_tree_dirty()) ? DIRTY_NOTE : undefined
}

// The ship's body draft goes with the pull request it opens; the ship's commit stage replaces it.
async function body_arguments(): Promise<ReadonlyArray<string>> {
	const issue = git_branch.issue_from_branch(await git_command.branch())
	const draft = issue === undefined ? undefined : await run_ship_body_draft.existing(String(issue))

	return run_ship_body_draft.body_arguments(draft)
}

// `josh run:review --push`, the background half: a skipped push exits 0, as nothing failed.
async function push(): Promise<number> {
	const reason = await skip_reason()

	if (reason !== undefined) {
		process.stdout.write(`${SKIPPED_NOTE}${reason}\n`)

		return SUCCESS_EXIT_CODE
	}

	const result = await josh_command.josh_run([...PUSH_ARGS, ...(await body_arguments())], true)

	process.stdout.write(`${result.out}\n`)

	return result.code
}

const run_review_early_push = { PUSH_FLAG, is_due, launch, prepare, push }

export { run_review_early_push }
