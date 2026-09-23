#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_followup_pending } from '#scripts/git/git-followup-pending'
import { release_scope_cli } from '#scripts/release/release-scope-cli'
import { run_carry } from './run-carry'
import { run_event_scope, type EventScope } from './run-event-scope'
import { run_event_stream, type RunEvent } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import { run_report } from './run-report'

// `josh run:report` — the session-facing report, generated from the run's event stream rather than
// composed by hand (joshuafolkken/kit#2249). It reads the events the run appended, asks `release:scope`
// the same question `josh followup` already asks, and prints `run_report.build_report` of the two. The AI
// writes only Step 0's three lines (Now / Change / Check), which `report-format.md` names as the half a
// machine cannot answer; this owns the mechanical half — what merged, what parked and why, what was cut,
// and whether a release is owed.
//
// **The body it prints is the Telegram body too.** `josh notify --body-file <file>` sends exactly this
// output, so the summary a session shows and the message a person reads off-screen are one string from one
// generator, never a second wording of the same facts.

const SUCCESS_EXIT_CODE = 0

// An absent or unreadable stream is an empty run, the same fail-quiet direction the stream's own reader
// takes — a report with no events is a report, not an error.
async function read_stream(): Promise<ReadonlyArray<RunEvent>> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) return []

	return run_event_stream.read_events(target)
}

// The invocation this report covers, taken from the run record that already holds the start time
// (joshuafolkken/kit#2393). A checkout whose git directory cannot be resolved has no record to read, which is
// the same undetermined answer an absent record gives — and neither one falls back to the whole stream.
async function read_scope(): Promise<EventScope> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return run_event_scope.UNKNOWN_EVENT_SCOPE

	return run_event_scope.scope_of(run_carry.read_carry(run_carry.carry_path(directory)))
}

// The three reads are independent, so they are issued together rather than one after another — the stream, the
// pending-merge count and the run record share no input.
async function run(): Promise<number> {
	const [events, pending, scope] = await Promise.all([
		read_stream(),
		git_followup_pending.read_pending({}),
		read_scope(),
	])
	const release = release_scope_cli.decide(pending)

	process.stdout.write(`${run_report.build_report({ events, release, scope })}\n`)

	return SUCCESS_EXIT_CODE
}

async function main(): Promise<void> {
	process.exitCode = await run()
}

const run_report_cli = {
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { run_report_cli }
