import { lane_net_read } from '#scripts/lane/lane-net-read'
import { issue_cite } from './issue-cite'
import { issue_priority } from './issue-priority'

// joshuafolkken/kit#5225: a refused `josh issue:file --found-during <N>` prints the causing-lane line
// filled from `josh lane:net <N>`, so the filer pastes it rather than running the command apart. Nothing
// is printed when the body already declares a causing lane, or the ledger holds no dispatch and merge of
// the lane yet.

async function lines_of(
	found_during: string | undefined,
	body: string,
): Promise<ReadonlyArray<string>> {
	if (found_during === undefined || issue_priority.lane_minutes(body) > 0) return []
	const minutes = await lane_net_read.net_minutes_of(Number(found_during))

	if (minutes === undefined) return []
	const line = `${issue_priority.LANE_PREFIX} ${String(minutes)} 分（${issue_cite.plain(found_during)}）`

	return [
		`↳ the causing lane from \`josh lane:net ${found_during}\`, to paste under \`## 背景\` when it caused this Issue:`,
		line,
	]
}

const issue_file_lane_hint = {
	lines_of,
}

export { issue_file_lane_hint }
