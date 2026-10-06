#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_merged } from '#scripts/issue/issue-merged'
import { run_tidy } from './run-tidy'
import { run_tidy_lanes, type IsMerged } from './run-tidy-lanes'
import { run_tidy_stashes } from './run-tidy-stashes'

// `josh run:tidy` — sweep what merged work left behind at a run's start (joshuafolkken/kit#2701): the
// lanes still holding a seat after their issue merged, and the stashes whose issues are all merged.
// Both used to wait for a person — `lane:list` flagged a merged lane, `run:carry --end` printed the
// closed-issue stashes — and a batch ran with two of six seats held by finished work until someone did.
//
// `run:hold` calls `sweep` once a claim succeeds, so every `fullrun` / `halfrun` start runs it; a
// `backlogrun` runs the command itself in its once-per-repository preparation, beside `lane:prune`.
// **The sweep never fails the run that called it**: the report goes to standard error, where
// `run:hold`'s one-token standard output is not disturbed, and a failed read is a note, not an exit.

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
		const lanes = await run_tidy_lanes.tidy_lanes(read_merged)
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
