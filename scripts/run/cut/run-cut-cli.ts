#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { git_command } from '#scripts/git/git-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { openai_lane_supervisor } from '#scripts/lane/openai-lane-supervisor'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_cli_fault } from '#scripts/run/run-cli-fault'
import { run_cut, type CutState, type RunCut } from './run-cut'
import { run_cut_args, type Request } from './run-cut-args'
import { run_cut_handoff } from './run-cut-handoff'
import { run_cut_report } from './run-cut-report'

// `josh run:cut` — the record that lets a lane child end its process before the gate and a fresh one
// resume from it. `run:cut <N>` writes the record and relaunches a fresh
// `fullrun #<N>`; the fresh process runs `run:cut --resume <N>` at its entry, which verifies the tree
// against the record and hands the run on to the gate. **Turning `argv` into a request is
// `run-cut-args.ts`'s**; what is here acts on the record and relaunches.
//
// The contract is `run:hold`'s and `run:carry`'s: **standard output carries exactly one token** and
// every explanation goes to standard error, so a loop can branch on `answer=$(pnpm josh run:cut 12)`.
// `--json` is the one exception, and it is still one line: the whole record has to reach a resuming
// session.

const ARGV_OFFSET = 2
const COMMAND = 'run:cut'

const {
	BAD_HANDOFF_VERDICT,
	BUSY_VERDICT,
	CUT_VERDICT,
	ENDED_VERDICT,
	FAILED_VERDICT,
	FAILURE_EXIT_CODE,
	FRESH_VERDICT,
	HANDED_OFF_VERDICT,
	HANDOFF_MISSING_NOTE,
	HANDOFF_OVERFLOW_NOTE,
	INCOMPLETE_VERDICT,
	NOT_A_LANE_VERDICT,
	OVER_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	STALE_VERDICT,
	SUCCESS_EXIT_CODE,
	UNDER_THRESHOLD_VERDICT,
	UNREADY_VERDICT,
	refuse_unready,
	report,
	report_bad_handoff,
	report_busy,
	report_fault,
	report_handed_off,
	report_incomplete,
	report_over,
	report_reviewer,
	report_stale,
	report_under_threshold,
	report_unknown,
	report_unreadable,
} = run_cut_report

// **The pre-gate cut is conditional on the same statistic the implementation-phase cut reads**.
// `cost_cli.session_verdict` prices the newest request against `CONTEXT_CUT_THRESHOLD`, so no second
// threshold is introduced — an `under` session skips the cut, and an unmeasurable one still cuts as
// the safety net. Only the pre-gate phase is checked here; the implementation-phase caller gates its own
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
		`The OpenAI supervisor for ${session_cite.issue(issue)} is not live, so this nested process was not cut and can continue. Re-dispatch the lane to recover the supervisor.`,
	)

	return report(FAILED_VERDICT, FAILURE_EXIT_CODE)
}

// **The relaunched child is started at the effort of the phase it is resuming into**.
// A pre-gate resume drives the gate, commit, PR and merge — the mechanical
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
	// cut that resumes into the gate rather than into implementation.
	handoff_path?: string | undefined
}

// **Every cut appends a `cut` event to the run's stream**. It is what advances
// `run:step` past the phase boundary — a cut emitted here is why the run's next position reads as
// `run:cut --resume`. Best-effort by the stream's contract, so a failed append never fails the cut it
// reports.
async function emit_cut_event(request: CutRequest): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.CUT,
		`${issue_cite.plain(request.issue)} cut (${request.phase})`,
	)
}

// The note a cut record is refused with before it is written, or `undefined` when it may be written.
function spec_refusal(spec: Parameters<typeof run_cut.begin_cut>[1]): string | undefined {
	if (!run_cut.has_required_handoff(spec)) return HANDOFF_MISSING_NOTE
	if (!run_cut.record_within_bound(spec)) return HANDOFF_OVERFLOW_NOTE

	return undefined
}

// Writes the record and appends the `cut` event, or answers the refusal that stopped it — the half of a
// cut every checkout shares; what follows the write (a relaunch or a stop) is the caller's.
async function write_cut(target: string, request: CutRequest): Promise<number | undefined> {
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

	return undefined
}

async function finish_cut(target: string, lane: LaneInfo, request: CutRequest): Promise<number> {
	const refused = await write_cut(target, request)

	if (refused !== undefined) return refused

	return lane_relaunch.is_openai_lane(lane)
		? report(CUT_VERDICT, SUCCESS_EXIT_CODE)
		: relaunch(target, lane, request.phase)
}

// The cut outside a lane is taken, and nothing is relaunched: the session that took it is the one a
// person is watching, so the run is handed on the way `fullrun`'s entry `over` stop hands it on.
function report_held_cut(issue: string): number {
	console.error(
		`The cut is recorded for ${session_cite.issue(issue)} outside a lane, so nothing was relaunched. Keep the hold, send a \`confirmation\` Telegram whose body names the resume command \`fullrun ${issue_cite.plain(issue)}\`, and end the turn; the fresh session's \`pnpm josh run:cut --resume ${issue}\` answers \`resume-impl\` with the handoff.`,
	)

	return report(CUT_VERDICT, SUCCESS_EXIT_CODE)
}

// **A `fullrun` held in its own checkout takes the implementation cut too**, so a run a person started
// has a bound on its context mid-implementation. The hold naming this issue is what marks the run — a
// tree nobody holds for it, and the pre-gate phase (which a held run's gate reaches in the same
// session), stay `not-a-lane`.
async function cut_outside_lane(
	target: string,
	request: Omit<CutRequest, 'branch'>,
): Promise<number> {
	if (request.phase !== run_cut.IMPLEMENTATION_PHASE) {
		return report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE)
	}

	const state = await run_cut.current_state()

	if (state.held_issue !== request.issue) return report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE)
	if (!(await is_lane_branch(state))) return refuse_unready(state)

	clear_expired(target)

	const refused = await write_cut(target, { ...request, branch: state.branch })

	return refused ?? report_held_cut(request.issue)
}

async function cut(
	target: string,
	issue: string,
	phase: string,
	handoff_path?: string,
): Promise<number> {
	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return await cut_outside_lane(target, { issue, phase, handoff_path })

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
// child is told which by the verdict rather than reconstructing it from the record.
function resume_verdict_for(cut_record: RunCut): string {
	return run_cut.resumes_into_implementation(cut_record.phase)
		? RESUME_IMPL_VERDICT
		: RESUME_VERDICT
}

// **An implementation resume removes the record; a pre-gate one marks it handed off**.
// The cuts have different multiplicities sharing one record: the pre-gate cut fires once per lane, so
// its record must survive to answer a second resume `handed-off`; the implementation cut is guarded by the run's
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
// on what the run was told to do rather than on the tree alone. The record is cleared
// on adoption, so this is where it reaches the fresh process.
function announce_handoff(cut_record: RunCut): void {
	if (cut_record.handoff !== undefined) {
		console.error(run_cut_handoff.describe_handoff(cut_record.handoff))
	}
}

// **An implementation resume appends a `resume` event**. It clears the record
// the `cut` event stood for, so the stream is what moves `run:step` back to implementation; a pre-gate
// resume keeps its record and appends nothing. Best-effort, as the cut's own append is.
async function emit_resume_event(issue: string, verdict: string): Promise<void> {
	if (verdict !== RESUME_IMPL_VERDICT) return

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.RESUME,
		`${issue_cite.plain(issue)} resumed`,
	)
}

async function adopt(target: string, cut_record: RunCut): Promise<number> {
	const taken = take_over(target, cut_record)

	if (taken === undefined) return report_busy(cut_record)

	announce_handoff(cut_record)

	const verdict = resume_verdict_for(cut_record)

	await emit_resume_event(cut_record.issue, verdict)

	return report(verdict, SUCCESS_EXIT_CODE)
}

// A relaunched lane child and a fresh session both measure `under`, so only the session that took an
// implementation cut resumes over the threshold; unmeasurable is not refused.
function is_over_threshold_resume(cut_record: RunCut): boolean {
	if (!run_cut.resumes_into_implementation(cut_record.phase)) return false

	return cost_cli.session_verdict() === cost_verdict.OVER_VERDICT
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

	if (is_over_threshold_resume(cut_record)) return report_over()

	return await adopt(target, cut_record)
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

type CutCommand = Extract<Request, { kind: 'cut' }>

// A bare cut is the pre-gate boundary and `--impl` the implementation-phase one.
function cut_phase(request: { is_implementation: boolean }): string {
	return request.is_implementation ? run_cut.IMPLEMENTATION_PHASE : run_cut.PRE_GATE_PHASE
}

// **A ship reviewer's cut is answered before the lane is looked up**: it
// runs in the implementing child's lane and under its hold, so every check below would read it as the
// run and relaunch a second child beside it. Asking about a cut (`--resume`, `--json`, `--end`) is
// untouched — only taking one is refused.
async function take_cut(target: string, request: CutCommand): Promise<number> {
	if (agent_session_role.is_reviewer()) return report_reviewer()

	return await cut(target, request.issue, cut_phase(request), request.handoff_path)
}

async function act(target: string, request: Request): Promise<number> {
	if (request.kind === 'cut') return await take_cut(target, request)

	if (request.kind === 'resume') return await resume(target, request.issue)

	if (request.kind === 'read') return read_json(target)

	return end(target)
}

async function answer(request: Request): Promise<number> {
	const directory = await run_cli_fault.directory_of(COMMAND, run_cut.worktree_directory)

	if (directory === undefined) return report_unknown()

	return await act(run_cut.cut_path(directory), request)
}

function refuse(): number {
	console.error(run_cut_args.USAGE)

	return FAILURE_EXIT_CODE
}

// Every path out prints exactly one token, including the ones nobody planned: an empty standard
// output matches no verdict, which a resume entry check reads as "not a resume" and would let a fresh
// process re-implement over a cut it should have carried. The token stays `unknown`, and the failure
// says what it was rather than borrowing the unreadable-git-directory message.
async function run(argv: ReadonlyArray<string>): Promise<number> {
	const parsed = run_cut_args.read_arguments(argv)

	if (parsed === undefined) return refuse()

	const request = run_cut_args.to_request(parsed)

	if (request === undefined) return refuse()

	try {
		return await answer(request)
	} catch (error) {
		return report_fault(run_cli_fault.message(COMMAND, error))
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
	NOT_A_LANE_VERDICT,
	OVER_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	STALE_VERDICT,
	UNDER_THRESHOLD_VERDICT,
	UNREADY_VERDICT,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_cut_cli }
