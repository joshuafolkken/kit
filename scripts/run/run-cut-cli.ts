#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { git_command } from '#scripts/git/git-command'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { openai_lane_supervisor } from '#scripts/lane/openai-lane-supervisor'
import { run_cut, type CutState, type RunCut } from './run-cut'
import { run_cut_args, type Request } from './run-cut-args'
import { run_cut_handoff } from './run-cut-handoff'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'

// `josh run:cut` — the record that lets a lane child end its process before the gate and a fresh one
// resume from it (joshuafolkken/kit#1839). `run:cut <N>` writes the record and relaunches a fresh
// `fullrun #<N>`; the fresh process runs `run:cut --resume <N>` at its entry, which verifies the tree
// against the record and hands the run on to the gate. **Turning `argv` into a request is
// `run-cut-args.ts`'s**; what is here acts on the record and relaunches.
//
// The contract is `run:hold`'s and `run:carry`'s: **standard output carries exactly one token** and
// every explanation goes to standard error, so a loop can branch on `answer=$(pnpm josh run:cut 12)`.
// `--json` is the one exception, and it is still one line: the whole record has to reach a resuming
// session.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const CUT_VERDICT = 'cut'
const RESUME_VERDICT = 'resume'
// An implementation-phase resume: the fresh process continues implementing rather than going to the
// gate (joshuafolkken/kit#1933). It is a distinct token so the resuming child branches on it without
// re-reading the record.
const RESUME_IMPL_VERDICT = 'resume-impl'
const FRESH_VERDICT = 'fresh'
// The recent-window context is under the shared cut threshold, so the pre-gate cut was not worth its
// resume and nothing was cut (joshuafolkken/kit#2312). A benign, non-failing answer: the run carries
// on to the gate itself, exactly as `not-a-lane` does.
const UNDER_THRESHOLD_VERDICT = 'under-threshold'
const STALE_VERDICT = 'stale'
// The record matched the tree but carried no instruction to resume on, so the run was refused rather
// than continued blind to what it was told to do (joshuafolkken/kit#2354).
const INCOMPLETE_VERDICT = 'incomplete'
// The `--handoff` path was given but could not be read as a handoff, or was too large for the record;
// the cut is refused rather than taken without the instruction it was meant to carry.
const BAD_HANDOFF_VERDICT = 'bad-handoff'
const HANDED_OFF_VERDICT = 'handed-off'
const BUSY_VERDICT = 'busy'
const NOT_A_LANE_VERDICT = 'not-a-lane'
const UNREADY_VERDICT = 'unready'
const FAILED_VERDICT = 'failed'
const ENDED_VERDICT = 'ended'
const UNREADABLE_VERDICT = 'unreadable'
const UNKNOWN_VERDICT = 'unknown'

function report(verdict: string, code: number): number {
	console.info(verdict)

	return code
}

function report_stale(cut_record: RunCut): number {
	console.error(run_cut.stale_message(cut_record))

	return report(STALE_VERDICT, FAILURE_EXIT_CODE)
}

function report_busy(cut_record: RunCut): number {
	console.error(run_cut.busy_message(cut_record))

	return report(BUSY_VERDICT, FAILURE_EXIT_CODE)
}

// The record matched the tree but carried no instruction; the run is refused rather than continued
// without what it was told to do (joshuafolkken/kit#2354).
function report_incomplete(cut_record: RunCut): number {
	console.error(run_cut.incomplete_message(cut_record))

	return report(INCOMPLETE_VERDICT, FAILURE_EXIT_CODE)
}

// The `--handoff` file parsed but the assembled record would not fit the byte bound — the scalar fields
// carry a handoff that fit alone past the cap (joshuafolkken/kit#2354).
const HANDOFF_OVERFLOW_NOTE = '--handoff <path> would grow the cut record past its byte bound'
// An implementation cut resumes into implementation, and that resume refuses a record with no
// instruction (`incomplete`) — so the cut is refused here instead of relaunching a successor that can
// only stop (joshuafolkken/kit#2484).
const HANDOFF_MISSING_NOTE = 'this cut resumes into implementation and needs --handoff <path>'

function report_bad_handoff(note: string): number {
	console.error(`${note}. Nothing was cut; write the handoff file and reissue.`)

	return report(BAD_HANDOFF_VERDICT, FAILURE_EXIT_CODE)
}

// A successor already resumed this cut; a process woken after its own hand-off is told to stop rather
// than to investigate (joshuafolkken/kit#1935). It is a benign, non-failing stop.
function report_handed_off(cut_record: RunCut): number {
	console.error(run_cut.handed_off_message(cut_record))

	return report(HANDED_OFF_VERDICT, SUCCESS_EXIT_CODE)
}

function report_unreadable(): number {
	console.error(run_cut.unreadable_message())

	return report(UNREADABLE_VERDICT, FAILURE_EXIT_CODE)
}

function report_unknown(): number {
	console.error(run_cut.unknown_message())

	return report(UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

// A cut is only meaningful on a lane branch whose implementation is uncommitted. On the default
// branch, or with a clean tree, there is nothing to carry across the boundary.
function refuse_unready(state: CutState): number {
	console.error(
		`Not ready to cut on ${state.branch} (dirty: ${String(state.is_dirty)}); a cut needs an uncommitted lane branch. Nothing was cut.`,
	)

	return report(UNREADY_VERDICT, FAILURE_EXIT_CODE)
}

// Below the shared context threshold there is no accumulation a cut would drop, so the resume it would
// relaunch costs more than it saves; the current process carries the run on to the gate uncut.
function report_under_threshold(): number {
	console.error(
		'The recent-window context is under the shared cut threshold, so nothing was cut; a resume would cost more than the accumulation it would drop. Continue to the gate.',
	)

	return report(UNDER_THRESHOLD_VERDICT, SUCCESS_EXIT_CODE)
}

// **The pre-gate cut is conditional on the same statistic the implementation-phase cut reads**
// (joshuafolkken/kit#2312). `cost_cli.session_verdict` prices the recent `RECENT_REQUEST_WINDOW`
// against `CONTEXT_CUT_THRESHOLD`, so no second threshold is introduced — an `under` session skips the
// cut, and an unmeasurable one keeps the old unconditional cut as the safety net joshuafolkken/kit#1933
// relies on. Only the pre-gate phase is checked here; the implementation-phase caller gates its own
// `--impl` cut on `pnpm josh cost --cut` before it is ever issued.
function skips_pre_gate_cut(phase: string): boolean {
	if (phase !== run_cut.PRE_GATE_PHASE) return false

	return cost_cli.session_verdict() === cost_verdict.UNDER_VERDICT
}

// The exclusive create lost, so a cut is already in flight for this tree — the double-cut guard. The
// standing record is described rather than a bare token, so the reader sees which run holds it.
function report_cut_exists(target: string): number {
	const read = run_cut.read_cut(target)

	if (read.kind === 'carried' || read.kind === 'expired') return report_busy(read.cut)

	console.error('A cut is already in flight for this tree, so nothing was cut again.')

	return report(BUSY_VERDICT, FAILURE_EXIT_CODE)
}

// A relaunch failure clears the record so the current process can carry on to the gate itself — the
// run is never lost to a failed hand-off, and the failure is reported rather than passed off as a cut.
function report_relaunch_failure(target: string, note: string): number {
	run_cut.end_cut(target)
	console.error(
		`Relaunch failed: ${note}. The cut was cleared so this process can continue to the gate.`,
	)

	return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
}

function report_missing_supervisor(issue: string): number {
	console.error(
		`The OpenAI supervisor for #${issue} is not live, so this nested process was not cut and can continue. Re-dispatch the lane to recover the supervisor.`,
	)

	return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
}

// **The relaunched child is started at the effort of the phase it is resuming into**
// (joshuafolkken/kit#2382). A pre-gate resume drives the gate, commit, PR and merge — the mechanical
// ship/bookkeeping region, lowered — while an implementation resume keeps the role default. The
// phase-aware profile is `agent_argv.resume_argv`'s; a person's `JOSH_WORKER_EFFORT` still wins over it.
function relaunch(target: string, lane: LaneInfo, phase: string): number {
	const notes: Array<string> = []
	const result = lane_relaunch.resume(lane, phase, (note) => {
		notes.push(note)
	})

	if (result.kind !== 'launched') return report_relaunch_failure(target, result.note)

	if (notes.length > 0) console.error(notes.join('\n'))

	return report(CUT_VERDICT, SUCCESS_EXIT_CODE)
}

async function is_lane_branch(state: CutState): Promise<boolean> {
	const default_branch = await git_command.get_default_branch()

	return state.branch !== default_branch && state.is_dirty
}

// An expired record is a fresh process that never started; it is cleared so the next cut can begin
// rather than being wedged behind a stale file the exclusive create would refuse forever.
function clear_expired(target: string): void {
	if (run_cut.read_cut(target).kind === 'expired') run_cut.end_cut(target)
}

function has_matching_supervisor(lane: LaneInfo, issue: string): boolean {
	if (!lane_relaunch.is_openai_lane(lane)) return true

	return openai_lane_supervisor.active(lane.directory)?.issue === issue
}

interface CutRequest {
	branch: string
	issue: string
	phase: string
	// The `--handoff` path whose instruction and work state the record carries, absent for a pre-gate
	// cut that resumes into the gate rather than into implementation (joshuafolkken/kit#2354).
	handoff_path?: string | undefined
}

// **Every cut appends a `cut` event to the run's stream** (joshuafolkken/kit#2346). It is what advances
// `run:step` past the phase boundary — a cut emitted here is why the run's next position reads as
// `run:cut --resume`. Best-effort by the stream's contract, so a failed append never fails the cut it
// reports.
async function emit_cut_event(request: CutRequest): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.CUT,
		`#${request.issue} cut (${request.phase})`,
	)
}

// The note a cut record is refused with before it is written, or `undefined` when it may be written.
function spec_refusal(spec: Parameters<typeof run_cut.begin_cut>[1]): string | undefined {
	if (!run_cut.has_required_handoff(spec)) return HANDOFF_MISSING_NOTE
	if (!run_cut.record_within_bound(spec)) return HANDOFF_OVERFLOW_NOTE

	return undefined
}

async function finish_cut(target: string, lane: LaneInfo, request: CutRequest): Promise<number> {
	const loaded = run_cut_handoff.load_handoff(request.handoff_path, run_cut.MAX_HANDOFF_BYTES)
	if (loaded.kind === 'bad') return report_bad_handoff(loaded.note)

	const spec = {
		issue: request.issue,
		branch: request.branch,
		phase: request.phase,
		handoff: loaded.handoff,
	}

	const spec_note = spec_refusal(spec)

	if (spec_note !== undefined) return report_bad_handoff(spec_note)
	if (run_cut.begin_cut(target, spec) === undefined) return report_cut_exists(target)

	await emit_cut_event(request)

	return lane_relaunch.is_openai_lane(lane)
		? report(CUT_VERDICT, SUCCESS_EXIT_CODE)
		: relaunch(target, lane, request.phase)
}

async function cut(
	target: string,
	issue: string,
	phase: string,
	handoff_path?: string,
): Promise<number> {
	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE)

	const state = await run_cut.current_state()

	if (!(await is_lane_branch(state))) return refuse_unready(state)
	if (skips_pre_gate_cut(phase)) return report_under_threshold()

	clear_expired(target)
	if (!has_matching_supervisor(lane, issue)) return report_missing_supervisor(issue)

	return await finish_cut(target, lane, { issue, branch: state.branch, phase, handoff_path })
}

// **The adoption is the resume-uniqueness guarantee**: it removes and creates exclusively, so of two
// racing resumes only one wins the create and the loser is answered `busy`.
// An implementation cut resumes back into implementation; a pre-gate one into the gate. The resuming
// child is told which by the verdict rather than reconstructing it from the record
// (joshuafolkken/kit#1933).
function resume_verdict_for(cut_record: RunCut): string {
	return run_cut.resumes_into_implementation(cut_record.phase)
		? RESUME_IMPL_VERDICT
		: RESUME_VERDICT
}

// **An implementation resume removes the record; a pre-gate one marks it handed off**
// (joshuafolkken/kit#2310). The cuts have different multiplicities sharing one
// record: the pre-gate cut fires once per lane, so its record must survive to answer a second resume
// `handed-off` (joshuafolkken/kit#1935); the implementation cut is guarded by the run's
// event stream rather than the cut record, so its record is cleared on resume — a lingering record
// would keep the pre-gate guard, which reads `carried_cut_sync`, silent for the rest of the run. A double
// cut stays impossible either way: `begin_cut`'s exclusive create is what prevents it.
function take_over(target: string, cut_record: RunCut): RunCut | undefined {
	if (!run_cut.resumes_into_implementation(cut_record.phase)) {
		return run_cut.adopt_cut(target, cut_record)
	}

	run_cut.end_cut(target)

	return cut_record
}

// The carried instruction and work state, printed to standard error so the resumed session continues
// on what the run was told to do rather than on the tree alone (joshuafolkken/kit#2354). The record is
// cleared on adoption, so this is where it reaches the fresh process.
function announce_handoff(cut_record: RunCut): void {
	if (cut_record.handoff !== undefined) {
		console.error(run_cut_handoff.describe_handoff(cut_record.handoff))
	}
}

function adopt(target: string, cut_record: RunCut): number {
	const taken = take_over(target, cut_record)

	if (taken === undefined) return report_busy(cut_record)

	announce_handoff(cut_record)

	return report(resume_verdict_for(cut_record), SUCCESS_EXIT_CODE)
}

async function verify_and_adopt(
	target: string,
	cut_record: RunCut,
	issue: string,
): Promise<number> {
	const state = await run_cut.current_state()
	const verdict = run_cut.classify_resume(cut_record, {
		issue,
		current_branch: state.branch,
		is_dirty: state.is_dirty,
		is_held: state.is_held,
	})

	if (verdict === HANDED_OFF_VERDICT) return report_handed_off(cut_record)

	if (verdict === 'stale') return report_stale(cut_record)

	if (verdict === INCOMPLETE_VERDICT) return report_incomplete(cut_record)

	return adopt(target, cut_record)
}

async function resume(target: string, issue: string): Promise<number> {
	const read = run_cut.read_cut(target)

	if (read.kind === 'none') return report(FRESH_VERDICT, SUCCESS_EXIT_CODE)

	if (read.kind === 'unreadable') return report_unreadable()

	if (read.kind === 'expired') return report_stale(read.cut)

	return await verify_and_adopt(target, read.cut, issue)
}

function read_json(target: string): number {
	const read = run_cut.read_cut(target)
	const cut_record = read.kind === 'carried' || read.kind === 'expired' ? read.cut : undefined

	console.info(JSON.stringify({ verdict: read.kind, cut: cut_record }))

	return read.kind === 'unreadable' ? FAILURE_EXIT_CODE : SUCCESS_EXIT_CODE
}

function end(target: string): number {
	run_cut.end_cut(target)

	return report(ENDED_VERDICT, SUCCESS_EXIT_CODE)
}

// A bare cut is the pre-gate boundary and `--impl` the implementation-phase one (joshuafolkken/kit#1933).
function cut_phase(request: { is_implementation: boolean }): string {
	return request.is_implementation ? run_cut.IMPLEMENTATION_PHASE : run_cut.PRE_GATE_PHASE
}

async function act(target: string, request: Request): Promise<number> {
	if (request.kind === 'cut') {
		return await cut(target, request.issue, cut_phase(request), request.handoff_path)
	}

	if (request.kind === 'resume') return await resume(target, request.issue)

	if (request.kind === 'read') return read_json(target)

	return end(target)
}

async function answer(request: Request): Promise<number> {
	const directory = await run_cut.worktree_directory()

	if (directory === undefined) return report_unknown()

	return await act(run_cut.cut_path(directory), request)
}

function refuse(): number {
	console.error(run_cut_args.USAGE)

	return FAILURE_EXIT_CODE
}

// Every path out prints exactly one token, including the ones nobody planned: an empty standard
// output matches no verdict, which a resume entry check reads as "not a resume" and would let a fresh
// process re-implement over a cut it should have carried.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = run_cut_args.read_arguments(argv)

	if (parsed === undefined) return refuse()

	const request = run_cut_args.to_request(parsed)

	if (request === undefined) return refuse()

	try {
		return await answer(request)
	} catch {
		return report_unknown()
	}
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_cut_cli = {
	BAD_HANDOFF_VERDICT,
	BUSY_VERDICT,
	CUT_VERDICT,
	ENDED_VERDICT,
	FAILED_VERDICT,
	FRESH_VERDICT,
	HANDED_OFF_VERDICT,
	INCOMPLETE_VERDICT,
	NOT_A_LANE_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	STALE_VERDICT,
	UNDER_THRESHOLD_VERDICT,
	UNKNOWN_VERDICT,
	UNREADABLE_VERDICT,
	UNREADY_VERDICT,
	USAGE: run_cut_args.USAGE,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_cut_cli }
