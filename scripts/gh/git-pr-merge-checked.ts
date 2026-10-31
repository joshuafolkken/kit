import { poll } from '#scripts/lib/poll'
import { git_gh_command } from './git-gh-command'
import { git_pr_checks, type PrStateSnapshot } from './git-pr-checks'

// **A merge lands the head the merge gate passed, and nothing pushed after it** (#4036).
//
// The gate reads the checks of one commit, and the merge request names that commit as its `sha`. A
// push between the two moves the head, GitHub answers 409, and the wait starts over on the new head
// — so the push is merged once its own checks pass, with nobody having to re-run anything. The
// retries are bounded: a branch that keeps moving under every wait is not one to merge unattended.

const MAX_HEAD_MOVES = 3
const NO_CHECKED_HEAD_MESSAGE =
	'The merge gate answered without the head commit it checked, so there is no commit to bind the merge to'
const HEAD_MOVED_NOTE =
	'The pull request head moved after its checks passed — waiting on the new head'
const HEAD_KEPT_MOVING_MESSAGE = `The pull request head moved after its checks passed ${String(MAX_HEAD_MOVES)} times, so it was not merged`

type WaitForGreen = () => Promise<PrStateSnapshot>

interface CheckedMerge {
	branch_name: string
	// The wait to go back to when the head moved — the caller's own, so a re-wait watches what the
	// first wait watched.
	wait_for_green: WaitForGreen
	// The snapshot the gate already passed. Absent, the merge waits for one first.
	checked?: PrStateSnapshot | undefined
}

function checked_head(snapshot: PrStateSnapshot): string {
	if (snapshot.head_sha === undefined) throw new Error(NO_CHECKED_HEAD_MESSAGE)

	return snapshot.head_sha
}

// `false` is "the head moved"; every other failure is the caller's to see.
async function try_merge(branch_name: string, snapshot: PrStateSnapshot): Promise<boolean> {
	const head_sha = checked_head(snapshot)

	try {
		await git_gh_command.pr_merge(branch_name, head_sha)

		return true
	} catch (error) {
		if (!git_gh_command.is_head_moved(error)) throw error

		return false
	}
}

async function merge_checked(input: CheckedMerge): Promise<void> {
	const progress = { snapshot: input.checked ?? (await input.wait_for_green()) }

	const is_merged = await poll.poll_until(
		async () => {
			if (await try_merge(input.branch_name, progress.snapshot)) return true

			console.info(HEAD_MOVED_NOTE)
			Object.assign(progress, { snapshot: await input.wait_for_green() })

			return false
		},
		{
			attempts: MAX_HEAD_MOVES,
			interval_ms: 0,
			sleeper: async () => {
				await Promise.resolve()
			},
		},
	)
	if (is_merged) return

	throw new Error(HEAD_KEPT_MOVING_MESSAGE)
}

// The merge gate's default wait, then the bound merge.
async function merge_when_green(branch_name: string): Promise<void> {
	async function wait_for_green(): Promise<PrStateSnapshot> {
		return await git_pr_checks.wait_for_pr_success(branch_name)
	}

	await merge_checked({ branch_name, wait_for_green })
}

const git_pr_merge_checked = {
	merge_checked,
	merge_when_green,
}

export type { CheckedMerge, WaitForGreen }
export { git_pr_merge_checked, HEAD_KEPT_MOVING_MESSAGE, MAX_HEAD_MOVES, NO_CHECKED_HEAD_MESSAGE }
