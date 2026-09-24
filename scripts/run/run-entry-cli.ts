#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_entry, type EntryParts } from './run-entry'
import { run_hold_cli } from './run-hold-cli'
import { run_next } from './run-next'
import { run_prep } from './run-prep'
import { run_prep_cli } from './run-prep-cli'
import { run_step } from './run-step'

// `josh run:entry <N>` — one call for the fixed entry sequence a lane opens on (joshuafolkken/kit#2372).
// The loop used to spend a round trip on `run:hold`, one on `cost --cut`, one on `run:prep` and one on
// `run:step`, re-billing a lane's full context each time; this runs all four internally and prints one
// composite report, the same way `backlog:offer` folds `backlog:next` → `backlog:budget` and `run:prep`
// folds three reads.
//
// **The stops short-circuit.** A `busy` / `unknown` hold and an `over` budget both end the run, so the
// composite reports them without reading the issue — the gate `fullrun.md` steps 1 and 3 stop on stays a
// gate, decided from the token rather than a sentence. `cost --cut` is skipped in a dispatched lane
// child, where the parent owns the budget question — the same lane-aware skip `run:prep` makes for
// `latest`.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const ISSUE_NUMBER_PATTERN = /^[1-9]\d*$/u
const USAGE = 'Usage: josh run:entry <issue-number>'
const should_forward_stderr = true
const NEWLINE = '\n'

const HOLD_STOP_NOTE =
	'(tree not held — see the reason above; clean up and retry, or release with `pnpm josh run:release`)'
const COST_STOP_NOTE = '(session budget spent — see the figure above; resume in a fresh session)'

// Exactly one issue number, or the call is refused — `run:entry` opens one run, and a second number
// would claim and read a second issue a caller reads as this one's.
function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1 || !ISSUE_NUMBER_PATTERN.test(first)) {
		return undefined
	}

	return first
}

function first_line(out: string): string {
	return out.split(NEWLINE)[0] ?? ''
}

// `run:hold <N>` prints one token — `hold`, `busy` or `unknown` — and forwards its explanation to
// stderr, so the composite branches on the token and the reader still sees why.
async function claim_hold(issue_number: string): Promise<string> {
	const held = await josh_command.josh_run(['run:hold', issue_number], should_forward_stderr)

	return first_line(held.out)
}

// A dispatched lane child never asks the session boundary — the parent owns it once per session
// (`backlogrun-progress.md` → "The hand-off") — so this records `skipped` rather than reading a budget
// nothing in the lane acts on, the same shape `run:prep` skips `latest` in a lane.
async function check_cost(): Promise<string> {
	if (lane_child_marker.is_child_of(process.cwd())) return run_entry.COST_SKIPPED

	const cut = await josh_command.josh_run(['cost', '--cut'], should_forward_stderr)

	return first_line(cut.out)
}

interface Reads {
	report: string
	verdict: string
}

// The issue reads and the pre-implementation verdict, from the one gather `run:prep` and `run:next`
// already share (joshuafolkken/kit#2188) rather than a second copy — the report is `run:prep`'s
// formatter, the verdict is `run:step`'s `pre_verdict` over the same parts.
async function gather_reads(issue_number: string): Promise<Reads> {
	const reads = await run_prep_cli.gather(issue_number)
	const parts = run_prep_cli.to_parts(issue_number, reads)
	const verdict = run_step.pre_verdict(run_next.to_input(parts))

	return { report: run_prep.format_report(parts), verdict }
}

function emit(parts: EntryParts): number {
	console.info(run_entry.format_report(parts))

	return run_entry.exit_code(parts)
}

// The summary of a run that stopped before it read the issue: the token that stopped it, no verdict,
// and the note that stands in for the report body.
function stop_report(issue_number: string, hold: string, cost: string, report: string): number {
	return emit({ issue_number, hold, cost, verdict: run_entry.NO_VERDICT, report })
}

async function open_run(issue_number: string): Promise<number> {
	const hold = await claim_hold(issue_number)

	if (hold !== run_hold_cli.HOLD_VERDICT) {
		return stop_report(issue_number, hold, run_entry.COST_SKIPPED, HOLD_STOP_NOTE)
	}

	const cost = await check_cost()

	if (cost === run_entry.COST_OVER) return stop_report(issue_number, hold, cost, COST_STOP_NOTE)

	const reads = await gather_reads(issue_number)

	return emit({ issue_number, hold, cost, verdict: reads.verdict, report: reads.report })
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const issue_number = parse_number(argv)

	if (issue_number === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await open_run(issue_number)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_entry_cli = { SUCCESS_EXIT_CODE, USAGE, check_cost, claim_hold, main, parse_number, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_entry_cli }
