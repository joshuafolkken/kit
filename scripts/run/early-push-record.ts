import { git_branch } from '#scripts/git/git-branch'
import { git_command } from '#scripts/git/git-command'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'

// Measurement is best-effort, including the branch read outside a repository. `slots` is the review
// round's slot count, where the caller knows it.
async function record(source: 'review' | 'ship', result: string, slots?: number): Promise<void> {
	try {
		const issue = git_branch.issue_from_branch(await git_command.branch())
		const head = await git_command.head_commit()

		await lane_ledger_write.record_early_push({
			source,
			result,
			head,
			...(issue !== undefined && { issue }),
			...(slots !== undefined && { slots }),
		})
	} catch {
		// A missing measurement never blocks a push.
	}
}

const early_push_record = { record }

export { early_push_record }
