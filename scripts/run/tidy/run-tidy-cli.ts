#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { issue_merged } from '#scripts/issue/issue-merged'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_tidy } from './run-tidy'
import { run_tidy_lanes, type IsMerged } from './run-tidy-lanes'
import { run_tidy_stashes } from './run-tidy-stashes'

// `josh run:tidy` — sweep what merged work left behind at a run's start: the lanes still holding a
// seat after their issue merged, and the stashes whose issues are all merged.
//
// `run:hold` calls `sweep` once a claim succeeds, so every `fullrun` / `halfrun` start runs it; a
// `backlogrun` runs the command itself in its once-per-repository preparation, beside `lane:prune`.
// **The sweep never fails the run that called it**: the report goes to standard error, where
// `run:hold`'s one-token standard output is not disturbed, and a failed read is a note, not an exit.
// A lane the running `backlogrun` still has in flight is left to its `run:merge`.

const FAILURE_NOTE = 'run:tidy could not finish; merged lanes and stashes may remain:'

// One read per issue across both halves — a lane and its stash usually name the same one.
function memoized(read: IsMerged): IsMerged {
	const answers = new Map<string, Promise<boolean>>()

	return async function read_once(issue: string): Promise<boolean> {
		const cached = answers.get(issue) ?? read(issue)

		answers.set(issue, cached)

		return await cached
	}
}

async function sweep(): Promise<void> {
	try {
		const read_merged = memoized(issue_merged.read_merged)
		const in_flight = backlog_drive_restore.active_issues(
			await run_event_stream_emit.current_events(),
		)
		const lanes = await run_tidy_lanes.tidy_lanes(read_merged, in_flight)
		const stashes = await run_tidy_stashes.tidy_stashes(read_merged)
		const report = run_tidy.format_report([...lanes, ...stashes])

		if (report !== undefined) console.error(report)
	} catch (error) {
		console.error(FAILURE_NOTE, error)
	}
}

const run_tidy_cli = { sweep }

if (process.argv[1] === fileURLToPath(import.meta.url)) await sweep()

export { run_tidy_cli }
