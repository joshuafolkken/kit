import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { issue_merged } from '#scripts/issue/issue-merged'
import { lane_ledger_archive } from '#scripts/lane/lane-ledger-archive'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship_lap } from '#scripts/run/ship/run-ship-lap'
import { run_tidy } from './run-tidy'
import { run_tidy_lanes, type IsMerged } from './run-tidy-lanes'
import { run_tidy_stashes } from './run-tidy-stashes'

// `josh run:tidy` — sweep what merged work left behind at a run's start: the lanes still holding a
// seat after their issue merged, and the stashes whose issues are all merged — then rotate the lane
// ledger's records past the retention into its archive.
//
// `run:hold` calls `sweep` once a claim succeeds, so every `fullrun` / `halfrun` start runs it; a
// `backlogrun` runs the command itself in its once-per-repository preparation, beside `lane:prune`.
// **The sweep never fails the run that called it**: the report goes to standard error, where
// `run:hold`'s one-token standard output is not disturbed, and a failed read is a note, not an exit.
// A lane the running `backlogrun` still has in flight is left to its `run:merge`.

const FAILURE_NOTE = 'run:tidy could not finish; merged lanes and stashes may remain:'
const ROTATE_FAILURE_NOTE = 'run:tidy could not rotate the lane ledger:'

// One read per issue across both halves — a lane and its stash usually name the same one.
function memoized(read: IsMerged): IsMerged {
	const answers = new Map<string, Promise<boolean>>()

	return async function read_once(issue: string): Promise<boolean> {
		const cached = answers.get(issue) ?? read(issue)

		answers.set(issue, cached)

		return await cached
	}
}

async function sweep_residue(): Promise<void> {
	try {
		const is_merged = memoized(issue_merged.read_merged)
		const in_flight = backlog_drive_restore.active_issues(
			await run_event_stream_emit.current_events(),
		)
		const lanes = await run_tidy_lanes.tidy_lanes(is_merged, in_flight)
		const stashes = await run_tidy_stashes.tidy_stashes(is_merged)
		const report = run_tidy.format_report([...lanes, ...stashes])

		if (report !== undefined) console.error(report)
	} catch (error) {
		console.error(FAILURE_NOTE, error)
	}
}

// The lane ledger's old records moved to its archive (joshuafolkken/kit#7038).
async function rotate_ledger(): Promise<void> {
	try {
		await lane_ledger_archive.rotate_target()
	} catch (error) {
		console.error(ROTATE_FAILURE_NOTE, error)
	}
}

async function sweep_all(): Promise<void> {
	await sweep_residue()
	await rotate_ledger()
}

async function sweep(): Promise<void> {
	await run_ship_lap.timed('sweep', sweep_all)
}

const run_tidy_cli = { sweep }

export { run_tidy_cli }
