#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { run_cut_report } from './run-cut-report'
import { run_entry, type EntryParts } from './run-entry'
import { run_halfrun_resume } from './run-halfrun-resume'
import { run_hold_cli } from './run-hold-cli'
import { run_next } from './run-next'
import { run_prep } from './run-prep'
import { run_prep_cli } from './run-prep-cli'
import { run_prrun_resume } from './run-prrun-resume'
import { run_stage, type StageCommand, type StageDecision } from './run-stage'
import { run_stage_read, type StageRead } from './run-stage-read'
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
const USAGE = 'Usage: josh run:entry <issue-number> [--to kickoff|halfrun|prrun|fullrun]'
const TO_FLAG = '--to'
// The flag and its command.
const TO_ARGUMENT_COUNT = 2
const should_forward_stderr = true
const NEWLINE = '\n'

const HOLD_STOP_NOTE =
	'(tree not held — see the reason above; clean up and retry, or release with `pnpm josh run:release`)'
const COST_STOP_NOTE = '(session budget spent — see the figure above; resume in a fresh session)'
const HALFRUN_RESUME_TOKEN = 'halfrun'

// Exactly one issue number, or the call is refused — `run:entry` opens one run, and a second number
// would claim and read a second issue a caller reads as this one's.
function parse_number(argv: ReadonlyArray<string>): string | undefined {
	const [first] = argv

	if (first === undefined || argv.length !== 1 || !ISSUE_NUMBER_PATTERN.test(first)) {
		return undefined
	}

	return first
}

interface EntryRequest {
	issue_number: string
	command: StageCommand
}

// `--to <command>` names how far the run goes (joshuafolkken/kit#3042); absent, it is `fullrun`.
// Anything else is refused.
function parse_command(rest: ReadonlyArray<string>): StageCommand | undefined {
	if (rest.length === 0) return run_stage.DEFAULT_COMMAND

	const [flag, value] = rest

	if (flag !== TO_FLAG || rest.length !== TO_ARGUMENT_COUNT) return undefined

	return run_stage.to_command(value)
}

function parse_request(argv: ReadonlyArray<string>): EntryRequest | undefined {
	const issue_number = parse_number(argv.slice(0, 1))
	const command = parse_command(argv.slice(1))

	return issue_number === undefined || command === undefined ? undefined : { issue_number, command }
}

function first_line(out: string): string {
	return out.split(NEWLINE)[0] ?? ''
}

// `run:hold <N>` prints one token — `hold`, `busy` or `unknown` — and forwards its explanation to
// stderr, so the composite branches on the token and the reader still sees why. `--fullrun` marks the
// hold as a run whose implementation cut resumes as `fullrun #N` (joshuafolkken/kit#2760) — a
// `fullrun`'s, and a `prrun`'s, which runs `fullrun`'s steps; a `halfrun`'s hold is never marked.
async function claim_hold(issue_number: string, command: StageCommand): Promise<string> {
	const mark = command === run_stage.HALFRUN ? [] : ['--fullrun']
	const held = await josh_command.josh_run(
		['run:hold', issue_number, ...mark],
		should_forward_stderr,
	)

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

interface Resume {
	token: string
	code: number
}

// **A resume is asked before the hold is claimed** (joshuafolkken/kit#2760). An implementation cut
// outside a lane keeps its hold, so the fresh session's `fullrun #N` would be refused `busy` by its own
// run's hold before it ever reached `run:cut --resume` — the hand-off the cut promised could not land.
async function ask_resume(issue_number: string): Promise<Resume> {
	const asked = await josh_command.josh_run(
		['run:cut', '--resume', issue_number],
		should_forward_stderr,
	)

	return { token: first_line(asked.out), code: asked.code }
}

// Anything but `fresh` is `run:cut --resume`'s answer to act on (`pre-gate-cut.md`), not a new run: the
// token and its exit code are passed through, and nothing is claimed or read.
function resume_report(issue_number: string, resume: Resume): number {
	console.info(`entry #${issue_number} — resume: ${resume.token}`)

	return resume.code
}

// **A `halfrun` stopped before its commit is resumed, not claimed** (joshuafolkken/kit#2796): its hold
// is kept over the verified diff, so the claim below would answer `busy` against it. The budget is asked
// first, as for any run; then the hold is adopted and the run goes to the gate, skipping everything up
// to and including implementation. **A `prrun` stopped before its merge is resumed the same way**
// (joshuafolkken/kit#3023), under the token that says what is left of it.
async function resume_stopped(
	issue_number: string,
	token: string,
	stopped_run: { adopt: (issue: string) => Promise<boolean> },
): Promise<number> {
	const cost = await check_cost()

	if (cost === run_entry.COST_OVER) return stop_report(issue_number, token, cost, COST_STOP_NOTE)

	if (!(await stopped_run.adopt(issue_number))) {
		return stop_report(issue_number, run_hold_cli.BUSY_VERDICT, cost, HOLD_STOP_NOTE)
	}

	console.info(`entry #${issue_number} — resume: ${token}`)

	return SUCCESS_EXIT_CODE
}

// The stopped run a decision picks up: a `halfrun` stop resumes at the gate, a `prrun` stop at
// `followup` under its own token. `undefined` for any other start, so the ordinary claim decides.
async function resume_any(
	issue_number: string,
	decision: StageDecision,
	stage: StageRead,
): Promise<number | undefined> {
	if (decision.state === run_stage.HALFRUN_STOPPED) {
		return await resume_stopped(issue_number, HALFRUN_RESUME_TOKEN, run_halfrun_resume)
	}

	return stage.prrun_token === undefined
		? undefined
		: await resume_stopped(issue_number, stage.prrun_token, run_prrun_resume)
}

// **A command whose stopping point the issue has already reached redoes nothing** (joshuafolkken/kit#3042)
// — the stage line is the whole report. A merged issue is the exception: the ordinary entry already
// answers it (`already-done`, or `keep-work` over a lane's uncommitted work), so it is left to that.
function is_settled(decision: StageDecision): boolean {
	return decision.is_reached && decision.state !== run_stage.MERGED
}

async function claim_run({ issue_number, command }: EntryRequest): Promise<number> {
	const hold = await claim_hold(issue_number, command)

	if (hold !== run_hold_cli.HOLD_VERDICT) {
		return stop_report(issue_number, hold, run_entry.COST_SKIPPED, HOLD_STOP_NOTE)
	}

	const cost = await check_cost()

	if (cost === run_entry.COST_OVER) return stop_report(issue_number, hold, cost, COST_STOP_NOTE)

	const reads = await gather_reads(issue_number)

	return emit({ issue_number, hold, cost, verdict: reads.verdict, report: reads.report })
}

// A carried cut is asked first, before anything is read (`run:cut --resume`); `kickoff` claims and cuts
// nothing, so it never asks. `undefined` when no cut is waiting.
async function resume_cut(request: EntryRequest): Promise<number | undefined> {
	if (request.command === run_stage.KICKOFF) return undefined

	const resume = await ask_resume(request.issue_number)

	return resume.token === run_cut_report.FRESH_VERDICT
		? undefined
		: resume_report(request.issue_number, resume)
}

// `kickoff` stops at the stage line whatever it says — it plans, and claims nothing.
async function open_run(request: EntryRequest): Promise<number> {
	const { issue_number, command } = request
	const cut = await resume_cut(request)

	if (cut !== undefined) return cut

	const stage = await run_stage_read.read_stage(issue_number)
	const decision = run_stage.decide(stage.state, command)

	console.info(run_stage.format_decision(issue_number, decision))

	if (command === run_stage.KICKOFF || is_settled(decision)) return SUCCESS_EXIT_CODE

	return (await resume_any(issue_number, decision, stage)) ?? (await claim_run(request))
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const request = parse_request(argv)

	if (request === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return await open_run(request)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_entry_cli = {
	HALFRUN_RESUME_TOKEN,
	parse_number,
	parse_request,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_entry_cli }
