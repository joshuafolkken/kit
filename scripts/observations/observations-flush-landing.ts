import { git_gh_command } from '#scripts/git/git-gh-command'
import type { OpenPull } from '#scripts/git/git-gh-pr-auto-merge'
import { git_pr_checks } from '#scripts/git/git-pr-checks'

// **A flush pull request lands whether or not the flush that opened it is still alive**
// (joshuafolkken/kit#2497). The merge used to happen only inside the flush's own wait, so a session
// cut or a killed process left a green pull request open with nobody to merge it — and once a later
// flush appended to the same ledger tail, it conflicted and could not land at all. Auto-merge moves
// the merge to GitHub, and the wait that remains is only for fast-forwarding the local default
// branch.

const AUTO_MERGE_WARNING =
	'Could not enable auto-merge on the flush pull request, so it merges only if this command stays alive to merge it:'
const MERGE_TIMEOUT_REASON =
	'auto-merge is enabled, but the pull request did not merge within the checks budget'
const MERGE_FAILED_REASON =
	'a required check failed or the branch conflicts, so auto-merge will not land the pull request'

// **Best-effort, and the answer says which wait to use.** GraphQL — the only way to enable auto-merge
// — can be refused in a cloud session (joshuafolkken/kit#1022), and that loses the safety net rather
// than the flush: the in-process wait-and-merge still runs, exactly as before auto-merge existed.
async function request_auto_merge(branch_name: string): Promise<boolean> {
	try {
		await git_gh_command.pr_enable_auto_merge(branch_name)

		return true
	} catch (error) {
		console.warn(AUTO_MERGE_WARNING, error instanceof Error ? error.message : String(error))

		return false
	}
}

// With auto-merge on, GitHub merges and this only waits to see it; `pr_merge` is not called, because
// the merge gate's wait would run out its budget on a pull request that is already merged.
async function wait_for_landing(branch_name: string, is_auto_merge: boolean): Promise<void> {
	if (!is_auto_merge) {
		await git_pr_checks.wait_for_pr_success(branch_name)
		await git_gh_command.pr_merge(branch_name)

		return
	}

	const progress = await git_pr_checks.wait_for_pr_merged(branch_name)

	if (progress === 'failed') throw new Error(MERGE_FAILED_REASON)
	if (progress === 'waiting') throw new Error(MERGE_TIMEOUT_REASON)
}

function describe_pull(pull: OpenPull): string {
	return `#${String(pull.number)} (\`${pull.head_ref}\`)`
}

// **Landing means GitHub will merge it with nobody watching**: auto-merge is on and the merge gate has
// not failed it — a red check or a conflict leaves auto-merge armed but never firing. One that merged
// between the listing and this read has landed, so it defers rather than reading as stuck.
async function is_landing(pull: OpenPull): Promise<boolean> {
	if (!pull.has_auto_merge) return false

	return (await git_pr_checks.read_merge_progress(pull.head_ref)) !== 'failed'
}

function landing_flush_message(pulls: ReadonlyArray<OpenPull>): string {
	return `deferred — an earlier flush pull request is still landing with auto-merge on: ${pulls.map((pull) => describe_pull(pull)).join(', ')}. A new flush branch would conflict with it at the ledger's tail, so the appended observations stay in this working tree for the next flush.`
}

// **Named rather than silently skipped**, because its lines exist only on its branch: once a later
// flush appends to the same tail it conflicts and can no longer land by itself. A flush still running
// in another checkout without auto-merge reads the same way, so the message allows for it.
function stuck_flush_message(pulls: ReadonlyArray<OpenPull>): string {
	return `An earlier \`pnpm josh observations:flush\` left a pull request open that nothing will merge — unless a flush in another checkout is still waiting on it: ${pulls.map((pull) => describe_pull(pull)).join(', ')}. Its appended observations exist only on that branch — land it (resolve the ledger conflict if there is one, then merge) before flushing again, or a new flush would conflict with it.`
}

// **`undefined` means no earlier flush is open, and a flush may cut its branch.** An earlier one that
// is still landing defers this flush with a message; one that will never land refuses it.
async function refuse_open_flush(branch_prefix: string): Promise<string | undefined> {
	const pulls = await git_gh_command.pr_list_open_with_head_prefix(branch_prefix)
	if (pulls.length === 0) return undefined

	const verdicts = await Promise.all(pulls.map(async (pull) => await is_landing(pull)))
	const stuck = pulls.filter((_pull, index) => verdicts[index] !== true)
	if (stuck.length > 0) throw new Error(stuck_flush_message(stuck))

	return landing_flush_message(pulls)
}

const observations_flush_landing = {
	landing_flush_message,
	MERGE_FAILED_REASON,
	MERGE_TIMEOUT_REASON,
	refuse_open_flush,
	request_auto_merge,
	stuck_flush_message,
	wait_for_landing,
}

export { observations_flush_landing }
