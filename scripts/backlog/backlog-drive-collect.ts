import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'
import type { MergeResult } from '#scripts/run/merge/run-merge-cli'
import { run_merge_driver } from '#scripts/run/merge/run-merge-driver'
import { backlog_drive_after_merge } from './backlog-drive-after-merge'
import { backlog_drive_owner } from './backlog-drive-owner'
import { backlog_drive_trace } from './backlog-drive-trace'

// The driver's collection of one finished child, out of `backlog-drive-cli.ts` so the ports file stays
// within its size.

const should_forward_stderr = true

// The collection's stages, named on a failure (joshuafolkken/kit#7859): the `collect failed` trace carries
// the error's first line, and this prefix says which stage threw it.
const STAGE = {
	OWNER: 'owner',
	LANE: 'lane',
	MERGE: 'run:merge',
	AFTER_MERGE: 'after-merge',
} as const

type Stage = (typeof STAGE)[keyof typeof STAGE]

async function staged<T>(stage: Stage, run: () => Promise<T>): Promise<T> {
	try {
		return await run()
	} catch (error) {
		throw new Error(`${stage}: ${error_text.message_of(error)}`, { cause: error })
	}
}

// A `run:merge` that printed no result — a crash before its verdict — answers no token, which the loop
// never reads as a collection.
function unprinted(code: number): MergeResult {
	return { token: '', code, is_offer: true, outcome: 'unresolved' }
}

// The child's transcript, where its lane recorded one, so `run:merge` can tell an API outage from a
// failure exactly as it does for the parent that passes `--output` by hand. Run as its own process
// (`run-merge-driver.ts`), so a fix merged since this loop started is the code that decides the child.
async function collected(issue: string, owner: string): Promise<MergeResult> {
	await staged(STAGE.OWNER, async () => await backlog_drive_owner.assert_current(owner))
	const lane = await staged(STAGE.LANE, async () => await lane_registry.find_open_lane(issue))
	const argv = run_merge_driver.argv_of({ child: issue, owner, output: lane?.output })
	const ran = await staged(
		STAGE.MERGE,
		async () => await josh_command.josh_run(argv, should_forward_stderr),
	)
	const result = run_merge_driver.read(ran.out) ?? unprinted(ran.code)

	await staged(STAGE.AFTER_MERGE, async () => {
		await backlog_drive_after_merge.after_merge(issue, result, owner)
	})

	return result
}

// The collection opened and closed on the stream (`backlog-drive-trace.ts`).
async function merge(issue: string, owner: string): Promise<MergeResult> {
	return await backlog_drive_trace.traced(
		issue,
		backlog_drive_trace.STEP.COLLECT,
		async () => await collected(issue, owner),
	)
}

const backlog_drive_collect = { merge }

export { backlog_drive_collect }
