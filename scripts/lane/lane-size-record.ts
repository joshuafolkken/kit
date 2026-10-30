import { git_gh_command } from '#scripts/gh/git-gh-command'
import { size_estimate } from '#scripts/issue/size-estimate'
import { split_measure } from '#scripts/split/split-measure'
import { lane_ledger_write } from './lane-ledger-write'

// The declared estimate next to what the lane actually changed, written by a merging `josh followup`
// before the merge — after it the branch is gone — so `lane:stats` can calibrate the split guide
// against real lanes (joshuafolkken/kit#5384). Best-effort, like every ledger line: an unreadable
// Issue, an Issue with no estimate or an unmeasurable branch records nothing and never blocks a merge.

async function declared_of(issue: string): Promise<{ files: number; lines: number } | undefined> {
	const read = await git_gh_command.issue_get_body_classified(issue)

	if (read.kind !== 'read' || read.text === undefined) return undefined
	const estimate = size_estimate.declared_size(read.text)

	return estimate === undefined ? undefined : { files: estimate.files, lines: estimate.lines }
}

async function measure_and_record(issue: string): Promise<void> {
	const declared = await declared_of(issue)

	if (declared === undefined) return
	const { files, lines } = await split_measure.read_branch()

	await lane_ledger_write.record_size({
		issue: Number(issue),
		declared,
		actual: { files, lines },
	})
}

async function record(should_merge: boolean, issue: string | undefined): Promise<void> {
	if (!should_merge || issue === undefined) return

	try {
		await measure_and_record(issue)
	} catch {
		// A measurement never fails the merge it measures.
	}
}

const lane_size_record = { record }

export { lane_size_record }
