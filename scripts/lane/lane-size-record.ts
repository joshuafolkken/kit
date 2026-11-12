import { issue_declared_size } from '#scripts/issue/issue-declared-size'
import { split_assess } from '#scripts/split/split-assess'
import { split_measure } from '#scripts/split/split-measure'
import { lane_ledger_write } from './lane-ledger-write'

// The declared estimate next to what the lane actually changed, written by a merging `josh followup`
// before the merge — after it the branch is gone — so `lane:stats` can calibrate the split guide
// against real lanes (joshuafolkken/kit#5384). Best-effort, like every ledger line: an unreadable
// Issue, an Issue with no estimate or an unmeasurable branch records nothing and never blocks a merge.
// A diff past the split notice bar is recorded `missed` — a pre-split miss, since the started lane
// was never split (joshuafolkken/kit#7183).

async function measure_and_record(issue: string): Promise<void> {
	const declared = await issue_declared_size.read(issue)

	if (declared === undefined) return
	const measurement = await split_measure.read_branch()

	await lane_ledger_write.record_size({
		issue: Number(issue),
		declared,
		actual: { files: measurement.files, lines: measurement.lines },
		missed: split_assess.notice(measurement, declared) !== undefined,
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
