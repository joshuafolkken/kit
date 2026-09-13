import type { CarryRead } from '#scripts/run/run-carry'
import type { RunWake } from '#scripts/run/run-wake'
import { time_spans, type Span } from './time-spans'

// The state of the run this checkout is *carrying*, read from the `run:carry` and `run:wake` records
// rather than from a merged pull request (joshuafolkken/kit#1939).
//
// **`josh time` measured merged runs and could not see a stopped one.** The backlogrun of
// 2026-09-13 lost more time to a run cut and never resumed than to any work it did: the parent cut
// its budget, its owning VS Code session never exited, and three wake sessions spun up, found the run
// "busy", and exited having done nothing. None of that reaches a report built from a merged PR — a
// stopped run has no merge to select. This reads the two records the wake machinery already writes
// and says, in one block, whether the run ended, was handed off, or is simply stuck.
//
// **The record's presence is the run's incompleteness.** A run that finishes cleanly ends its carry
// record through `run:carry --end`, which removes the file — so a record still sitting here (carried
// or expired) is a run that never completed, and that is what `is_unfinished` reads.

const MS_PER_MINUTE = 60_000
// The window past which a run with no transcript activity is treated as idle rather than working —
// the same 30 minutes `run:liveness` uses for its own silent window, so the two agree on "stalled".
const SILENT_MINUTES = 30
const SILENT_WINDOW_MS = SILENT_MINUTES * MS_PER_MINUTE
const COST_DECIMALS = 2

// The carry-read kind that means the whole-run bound elapsed, matched here rather than imported so
// this module reads no more of `run-carry` than the two types it renders.
const EXPIRED_KIND = 'expired'
const CARRIED_KIND = 'carried'

// The tool names and josh subcommands that mean a session actually moved the work forward. A wake
// session that only checked `run:carry` / `run:hold` and exited touched none of them, which is what
// makes it a whiff rather than a resume that did something. The commands are matched against a span's
// full `josh_commands` list, so a chained merge segment counts as progress.
const PROGRESS_LABELS: ReadonlySet<string> = new Set(['Edit', 'Write', 'NotebookEdit'])
const PROGRESS_COMMANDS: ReadonlySet<string> = new Set(['josh git', 'josh followup', 'josh bump'])

// How the run stands, kept separate from `EndState`'s merged / stopped / not_detected. That axis says
// how a *session* ended; this says whether the *run* is progressing, and the two states the report
// could never express — a cut with no successor, and a live owner sitting idle — are members here.
type RunStatus =
	| 'not_measured'
	| 'running'
	| 'handed_off'
	| 'cut_no_successor'
	| 'owner_stalled'
	| 'owner_gone'
	| 'expired'

const NOT_MEASURED: RunStatus = 'not_measured'
const RUNNING: RunStatus = 'running'
const HANDED_OFF: RunStatus = 'handed_off'
const CUT_NO_SUCCESSOR: RunStatus = 'cut_no_successor'
const OWNER_STALLED: RunStatus = 'owner_stalled'
const OWNER_GONE: RunStatus = 'owner_gone'
const EXPIRED: RunStatus = 'expired'

// One wake session that spun up and did no work, already priced. The tally below turns a list of
// these into the count / dollars / times the block prints.
interface WhiffSession {
	at: string
	cost_usd: number
}

interface WhiffTotals {
	count: number
	cost_usd: number
	at: ReadonlyArray<string>
}

// Everything the block prints, computed once so `--json` carries the same figures the text shows.
interface RunStateFacts {
	status: RunStatus
	// Whether a record was there to read at all. `false` is the answer criterion the Issue names: no
	// record means "not measured", never "the run is fine".
	is_measured: boolean
	is_ended: boolean
	cuts: number
	is_handed_off: boolean
	is_owner_live: boolean
	// Best available marker for the last cut: the records carry no per-cut timestamp, so this is the
	// wake supervisor's own timing, and `undefined` where nothing recorded it.
	last_cut_at: string | undefined
	idle_ms: number | undefined
	whiffs: WhiffTotals
}

// What the classifier is handed. The records are read by the collector; the booleans and instants it
// derives are passed in so this stays a pure function a fixture can drive.
interface RunStateInput {
	carry: CarryRead
	is_owner_live: boolean
	wake: RunWake | undefined
	now_ms: number
	last_activity_ms: number | undefined
	whiffs: ReadonlyArray<WhiffSession>
}

function has_tool_call(spans: ReadonlyArray<Span>): boolean {
	return spans.some((span) => span.category === time_spans.TOOL_CATEGORY)
}

function made_progress(spans: ReadonlyArray<Span>): boolean {
	return spans.some(
		(span) =>
			PROGRESS_LABELS.has(span.label) ||
			span.josh_commands.some((command) => PROGRESS_COMMANDS.has(command)),
	)
}

// A whiff is a session that called tools but moved nothing: it woke, checked the run, and exited. The
// progress test reads `josh_commands` (every segment) rather than `josh_command` (only the first), so a
// session that merged through a chained call such as `git push && josh followup` is not miscounted.
// signal is the absence of any edit, commit or merge, not the session's exit code — a session that
// found the run "busy" exits non-zero yet is exactly the whiff this counts.
function is_whiff(spans: ReadonlyArray<Span>): boolean {
	return has_tool_call(spans) && !made_progress(spans)
}

function tally_whiffs(whiffs: ReadonlyArray<WhiffSession>): WhiffTotals {
	return {
		count: whiffs.length,
		cost_usd: whiffs.reduce((sum, whiff) => sum + whiff.cost_usd, 0),
		at: whiffs.map((whiff) => whiff.at),
	}
}

interface StatusInput {
	kind: CarryRead['kind']
	is_handed_off: boolean
	is_owner_live: boolean
	is_idle: boolean
}

// The status of a run that was never handed off: its owner is either gone, sitting idle, or working.
function active_status(is_owner_live: boolean, is_idle: boolean): RunStatus {
	if (!is_owner_live) return OWNER_GONE

	return is_idle ? OWNER_STALLED : RUNNING
}

function status_of(input: StatusInput): RunStatus {
	if (input.kind === EXPIRED_KIND) return EXPIRED
	if (input.is_handed_off) return input.is_owner_live ? HANDED_OFF : CUT_NO_SUCCESSOR

	return active_status(input.is_owner_live, input.is_idle)
}

// The wake record's own timing stands in for a per-cut timestamp the carry record does not keep:
// `held_at` is when a successor's bounded wait began, i.e. just after a cut; `woke_at` is the last
// unserved wake attempt. Neither, and the last cut is reported as unrecorded rather than guessed.
function last_cut_of(wake: RunWake | undefined): string | undefined {
	if (wake === undefined) return undefined

	return wake.held_at ?? wake.woke_at
}

function idle_of(now_ms: number, last_activity_ms: number | undefined): number | undefined {
	return last_activity_ms === undefined ? undefined : now_ms - last_activity_ms
}

function not_measured_facts(kind: CarryRead['kind'], whiffs: WhiffTotals): RunStateFacts {
	return {
		status: NOT_MEASURED,
		is_measured: false,
		// A `none` record is a run that ended (or never began); an `unreadable` one is genuinely
		// unknown, and neither is claimed as still running.
		is_ended: kind === 'none',
		cuts: 0,
		is_handed_off: false,
		is_owner_live: false,
		last_cut_at: undefined,
		idle_ms: undefined,
		whiffs,
	}
}

function measured_facts(input: RunStateInput, whiffs: WhiffTotals): RunStateFacts {
	const read = input.carry
	const carry = read.kind === CARRIED_KIND || read.kind === EXPIRED_KIND ? read.carry : undefined

	if (carry === undefined) return not_measured_facts(read.kind, whiffs)

	const idle_ms = idle_of(input.now_ms, input.last_activity_ms)
	const is_handed_off = carry.is_handed_off === true
	const status = status_of({
		kind: read.kind,
		is_handed_off,
		is_owner_live: input.is_owner_live,
		is_idle: idle_ms !== undefined && idle_ms >= SILENT_WINDOW_MS,
	})

	return {
		status,
		is_measured: true,
		is_ended: read.kind === EXPIRED_KIND,
		cuts: carry.cuts,
		is_handed_off,
		is_owner_live: input.is_owner_live,
		last_cut_at: last_cut_of(input.wake),
		idle_ms,
		whiffs,
	}
}

function classify(input: RunStateInput): RunStateFacts {
	const whiffs = tally_whiffs(input.whiffs)

	if (input.carry.kind === 'none' || input.carry.kind === 'unreadable') {
		return not_measured_facts(input.carry.kind, whiffs)
	}

	return measured_facts(input, whiffs)
}

// A run is unfinished whenever a record is still here to read: a clean finish removes it. This is what
// the no-argument path reads to decide whether to lead with the run state instead of the merged run.
function is_unfinished(facts: RunStateFacts): boolean {
	return facts.is_measured
}

const STATUS_TEXT: Record<RunStatus, string> = {
	not_measured: 'not measured — no carry record here to read',
	running: 'in progress',
	handed_off: 'cut, and a successor is carrying it',
	cut_no_successor: 'cut, but no successor took over',
	owner_stalled: 'owner process alive but idle',
	owner_gone: 'owner process gone, run not handed off',
	expired: 'past the whole-run bound, so left abandoned',
}

const HEADING = 'Run state (from run:carry / run:wake):'

function yes_no(is_true: boolean): string {
	return is_true ? 'yes' : 'no'
}

function idle_text(idle_ms: number | undefined): string {
	if (idle_ms === undefined) return 'unknown'

	return `${String(Math.round(idle_ms / MS_PER_MINUTE))} min since last activity`
}

function whiff_line(whiffs: WhiffTotals): Array<string> {
	if (whiffs.count === 0) return ['  whiff wake sessions: none']

	const dollars = `$${whiffs.cost_usd.toFixed(COST_DECIMALS)}`
	const times = whiffs.at.join(', ')

	return [`  whiff wake sessions: ${String(whiffs.count)} — ${dollars} total, at ${times}`]
}

function measured_lines(facts: RunStateFacts): Array<string> {
	return [
		`  cuts: ${String(facts.cuts)}`,
		`  last cut: ${facts.last_cut_at ?? 'not recorded'}`,
		`  handed off: ${yes_no(facts.is_handed_off)} · owner live: ${yes_no(facts.is_owner_live)}`,
		`  idle: ${idle_text(facts.idle_ms)}`,
		`  run ended: ${yes_no(facts.is_ended)}`,
		...whiff_line(facts.whiffs),
	]
}

// The block, whichever way it is placed. `not_measured` prints its one honest line and stops; a
// measured run prints the figures beneath the status.
function run_state_lines(facts: RunStateFacts | undefined): Array<string> {
	if (facts === undefined) return []

	const head = [HEADING, `  status: ${STATUS_TEXT[facts.status]}`]

	return facts.is_measured
		? [...head, ...measured_lines(facts)]
		: [...head, ...whiff_line(facts.whiffs)]
}

// The lead block the no-argument `josh time` prepends to the run-tree report: the run-state lines
// when the run is unfinished, so a stopped run is surfaced at the front, and nothing otherwise, so a
// completed run's report is not headed by a "not measured" line (#1939).
function lead_lines(facts: RunStateFacts): Array<string> {
	return is_unfinished(facts) ? run_state_lines(facts) : []
}

const time_run_state = {
	HEADING,
	NOT_MEASURED,
	RUNNING,
	HANDED_OFF,
	CUT_NO_SUCCESSOR,
	OWNER_STALLED,
	OWNER_GONE,
	EXPIRED,
	SILENT_WINDOW_MS,
	is_whiff,
	classify,
	is_unfinished,
	lead_lines,
	run_state_lines,
}

export type { RunStateFacts, RunStateInput, RunStatus, WhiffSession, WhiffTotals }
export { time_run_state }
