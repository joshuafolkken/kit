#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { git_followup_pending } from '#scripts/followup/git-followup-pending'
import { session_cite } from '#scripts/issue/session-cite'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { release_scope_cli } from '#scripts/release/release-scope-cli'
import { report_labels } from '#scripts/report/report-labels'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_scope, type EventScope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_report } from './run-report'
import { run_report_handoff, type Handoff } from './run-report-handoff'

// `josh run:report` — the session-facing report, generated from the run's event stream rather than
// composed by hand. It reads the events the run appended, asks `release:scope`
// the same question `josh followup` already asks, and prints `run_report.build_report` of the two. The AI
// writes only Step 0's three lines (Now / Change / Check), which `report-format.md` names as the half a
// machine cannot answer; this owns the mechanical half — what merged, what parked and why, what was cut,
// and whether a release is owed.
//
// **The body it prints is the Telegram body too.** `josh notify --body-file <file>` sends exactly this
// output, so the summary a session shows and the message a person reads off-screen are one string from one
// generator, never a second wording of the same facts.
//
// `--handoff` prints the `backlogrun` hand-off report (`run-report-handoff.ts`) from the same reads —
// the run record and the scoped stream — and sends it itself as the `confirmation`, the resume command
// as its `recommended` choice (joshuafolkken/kit#4161). The body is built with plain `#N` and linked
// here, at the print boundary, through `session_cite.text`.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const HANDOFF_FLAG = '--handoff'
const USAGE = `Usage: josh run:report [${HANDOFF_FLAG}]`
const NO_RECORD_NOTE =
	'No readable run record, so there is no run to hand off. Begin one with `pnpm josh run:carry --begin` first.'
const HANDOFF_TITLE = 'backlogrun hand-off'
const HANDOFF_RECOVERY = 'If this did not arrive, the session transcript holds the same report.'
const NO_RESUME_NOTE =
	'The run record names no resume command, so no hand-off confirmation was sent; the report above is the hand-off.'

// An absent or unreadable stream is an empty run, the same fail-quiet direction the stream's own reader
// takes — a report with no events is a report, not an error.
async function read_stream(): Promise<ReadonlyArray<RunEvent>> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined) return []

	return run_event_stream.read_events(target)
}

// The run record this checkout holds, or `undefined` when the git directory cannot be resolved.
async function read_record(): Promise<CarryRead | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	return run_carry.read_carry(run_carry.carry_path(directory))
}

// The invocation this report covers, taken from the run record that already holds the start time.
// A checkout whose git directory cannot be resolved has no record to read, which is the same
// undetermined answer an absent record gives — and neither one falls back to the whole stream.
function scope_of(read: CarryRead | undefined): EventScope {
	if (read === undefined) return run_event_scope.UNKNOWN_EVENT_SCOPE

	return run_event_scope.scope_of(read)
}

// The three reads are independent, so they are issued together rather than one after another — the stream, the
// pending-merge count and the run record share no input.
async function run_summary(): Promise<number> {
	const [events, pending, read] = await Promise.all([
		read_stream(),
		git_followup_pending.read_pending({}),
		read_record(),
	])
	const release = release_scope_cli.decide(pending)

	process.stdout.write(`${run_report.build_report({ events, release, scope: scope_of(read) })}\n`)

	return SUCCESS_EXIT_CODE
}

type CarriedRead = Extract<CarryRead, { kind: 'carried' }>

// The report is the hand-off, so it succeeds once printed. The send is `confirm`'s tolerant one, which
// already reports its own failure with `HANDOFF_RECOVERY` — a checkout with no Telegram credentials is
// one, and pointing it at `josh notify` would fail the same way. A record whose invocation names no
// resume command has no `recommended` to send.
async function send_handoff(handoff: Handoff): Promise<void> {
	if (handoff.resume === undefined) {
		console.error(NO_RESUME_NOTE)

		return
	}

	await telegram_notify.confirm({
		issue_title: HANDOFF_TITLE,
		body: handoff.body,
		recovery: HANDOFF_RECOVERY,
		recommended: handoff.resume,
		alternatives: [],
	})
}

function handoff_of(read: CarriedRead, events: ReadonlyArray<RunEvent>): Handoff {
	return run_report_handoff.build_handoff({
		carry: read.carry,
		events: run_event_scope.scoped_events(events, scope_of(read)) ?? [],
		figures: cost_cli.session_figures(),
		labels: report_labels.session_labels(),
	})
}

async function run_handoff(): Promise<number> {
	const [events, read] = await Promise.all([read_stream(), read_record()])

	if (read?.kind !== 'carried') {
		console.error(NO_RECORD_NOTE)

		return FAILURE_EXIT_CODE
	}

	const built = handoff_of(read, events)
	const handoff = { ...built, body: session_cite.text(built.body) }

	process.stdout.write(`${handoff.body}\n`)
	await send_handoff(handoff)

	return SUCCESS_EXIT_CODE
}

async function run(argv: ReadonlyArray<string> = []): Promise<number> {
	if (argv.length === 0) return await run_summary()
	if (argv.length === 1 && argv[0] === HANDOFF_FLAG) return await run_handoff()

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_report_cli = {
	NO_RECORD_NOTE,
	NO_RESUME_NOTE,
	USAGE,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_report_cli }
