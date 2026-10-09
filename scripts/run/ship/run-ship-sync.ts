import { git_gh_pr_read } from '#scripts/gh/git-gh-pr-read'
import { is_merge_conflict } from '#scripts/gh/git-pr-checks-eval'
import { git_command } from '#scripts/git/git-command'
import { main_merge, type MergeOutcome } from '#scripts/git/main-merge'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { error_text } from '#scripts/lib/error-message'
import { run_ship_scoped } from './run-ship-scoped'

// `josh ship` keeps the branch current with the default branch itself: a default branch that moves
// while the pull request opens and CI runs would otherwise stop the followup as `interrupted`, though
// merging the default branch again usually resolves it.
//
// So the merge happens mechanically: once before the commit (`sync_stage`), and once when
// the followup fails on a pull request GitHub reports `DIRTY` (`followup_stage`). Only a merge git
// itself cannot finish stops the ship, and it stops as `conflict`, naming the unmerged paths so the
// resumed session goes straight to them.

const should_forward_stderr = true
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
// A default branch that keeps moving under a pull request is merged again at most this often per ship;
// past it the followup failure stands, so a busy default branch cannot hold a ship in a loop.
const MAX_MERGE_RETRIES = 2
const CONFLICT_NOTE = 'merging the default branch left unmerged paths:'
const DEFERRED_PREFIX = 'merge deferred to the followup: '
const CURRENT_SUFFIX = ' brings nothing in'
const MERGED_PREFIX = 'merged '

// A stage's result, plus the paths a stopped merge left unmerged — carried to the stop prompt.
interface StepResult extends JoshResult {
	conflicts?: ReadonlyArray<string>
}

async function josh(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

// A merge that could not even be attempted — a fetch that failed — reads as a refusal: nothing was
// changed, and the followup still finds a real conflict on GitHub's side.
async function merge_outcome(): Promise<MergeOutcome> {
	try {
		return await main_merge.merge()
	} catch (error) {
		return { kind: 'refused', message: error_text.message_of(error) }
	}
}

function conflict_result(files: ReadonlyArray<string>, lead: string): StepResult {
	const out = [lead, CONFLICT_NOTE, ...files].filter((line) => line !== '').join('\n')

	return { code: FAILURE_EXIT_CODE, out, conflicts: files }
}

function sync_note(outcome: Exclude<MergeOutcome, { kind: 'conflict' }>): string {
	if (outcome.kind === 'refused') return `${DEFERRED_PREFIX}${outcome.message}`

	return outcome.kind === 'current'
		? `${outcome.branch}${CURRENT_SUFFIX}`
		: `${MERGED_PREFIX}${outcome.branch}`
}

// A refusal does not stop the commit: the guard refuses only uncommitted work the default branch also
// touches, and once that work is committed the followup merges again on a clean tree. A merge that changed
// the tree is checked by the gate stage that follows, so the commit never carries
// an unchecked merge and the gate's record names the merge base the push carries.
async function sync_stage(): Promise<StepResult> {
	const outcome = await merge_outcome()

	if (outcome.kind === 'conflict') return conflict_result(outcome.files, '')

	return { code: SUCCESS_EXIT_CODE, out: sync_note(outcome) }
}

// Any read that fails answers "not conflicting": the followup failure then stands as it was.
async function is_conflicting(): Promise<boolean> {
	try {
		const state = await git_gh_pr_read.pr_get_merge_state(await git_command.branch())

		return is_merge_conflict(state?.merge_state_status)
	} catch {
		return false
	}
}

// The merged tree is gated before it is pushed: the push then carries the tree
// the gate's record describes, so the pre-push hook reuses it rather than re-running the unit suite.
async function push_merged(title: string): Promise<StepResult | undefined> {
	const gate = await run_ship_scoped.scoped_gate()

	if (gate.code !== SUCCESS_EXIT_CODE) return gate

	const push = await josh(['git', '-y', '--skip-commit', '--skip-pr', title])

	return push.code === SUCCESS_EXIT_CODE ? undefined : push
}

// The result to stop on, or `undefined` once a clean merge is pushed and the followup can wait again.
async function merge_again(title: string, failed: JoshResult): Promise<StepResult | undefined> {
	if (!(await is_conflicting())) return failed

	const outcome = await merge_outcome()

	if (outcome.kind === 'conflict') return conflict_result(outcome.files, failed.out)
	if (outcome.kind !== 'merged') return failed

	return await push_merged(title)
}

async function followup_stage(
	title: string,
	notify: ReadonlyArray<string>,
	retries = 0,
): Promise<StepResult> {
	const result = await josh(['followup', title, ...notify])

	if (result.code === SUCCESS_EXIT_CODE || retries >= MAX_MERGE_RETRIES) return result

	const stop = await merge_again(title, result)

	return stop ?? (await followup_stage(title, notify, retries + 1))
}

const run_ship_sync = { CONFLICT_NOTE, MAX_MERGE_RETRIES, followup_stage, sync_stage }

export type { StepResult }
export { run_ship_sync }
