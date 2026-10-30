#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_relaunch } from '#scripts/lane/lane-relaunch'
import { openai_lane_supervisor } from '#scripts/lane/openai-lane-supervisor'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_cli_fault } from '#scripts/run/run-cli-fault'
import { split_resolution } from '#scripts/split/split-resolution'
import { run_cut } from './run-cut'
import { run_cut_args, type Request } from './run-cut-args'
import { run_cut_decline } from './run-cut-decline'
import { run_cut_digest } from './run-cut-digest'
import { run_cut_handoff } from './run-cut-handoff'
import { run_cut_ready } from './run-cut-ready'
import { run_cut_report } from './run-cut-report'
import { run_cut_resume } from './run-cut-resume'
import { run_cut_review } from './run-cut-review'

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
	HANDOFF_MISSING_NOTE,
	HANDOFF_OVERFLOW_NOTE,
	NOT_A_LANE_VERDICT,
	OVER_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	SPLIT_UNRESOLVED_VERDICT,
	SUCCESS_EXIT_CODE,
	UNDER_THRESHOLD_VERDICT,
	UNREADY_VERDICT,
	refuse_unready,
	report,
	report_bad_handoff,
	report_busy,
	report_fault,
	report_held_cut,
	report_missing_supervisor,
	report_relaunched_cut,
	report_reviewer,
	report_split_unresolved,
	report_under_threshold,
	report_unknown,
} = run_cut_report

// **The pre-gate cut is conditional on the same statistic the implementation-phase cut reads**.
// `cost_cli.session_verdict` prices the newest request against the `--cut` break-even, so no second
// threshold is introduced — an `under` session skips the cut, and an unmeasurable one still cuts as
// the safety net. Only the pre-gate phase is checked here; the implementation-phase caller gates its own
// `--impl` cut on `pnpm josh cost --cut` before it is ever issued.
//
// **A noticed Issue answers the split notice first** (joshuafolkken/kit#4695): the pre-gate cut is the
// boundary the notice names, so a lane that neither split nor recorded why is refused whether or not
// the cut itself would be taken. Returns the answer given without cutting, or `undefined`.
async function pre_gate_answer(issue: string, phase: string): Promise<number | undefined> {
	if (phase !== run_cut.PRE_GATE_PHASE) return undefined
	const split_note = await split_resolution.ledger_refusal(Number(issue))

	if (split_note !== undefined) return report_split_unresolved(split_note)

	return cost_cli.session_verdict() === cost_verdict.UNDER_VERDICT
		? report_under_threshold()
		: undefined
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

// **The relaunched child is started at the effort of the phase it is resuming into**.
// A pre-gate resume drives the gate, commit, PR and merge — the mechanical
// ship/bookkeeping region, lowered — while an implementation resume keeps the role default. The
// phase-aware profile is `agent_argv.resume_argv`'s; a person's `JOSH_WORKER_EFFORT` still wins over it,
// and a pre-gate resume moves to `JOSH_WORKER_SHIP_MODEL` when that is set.
async function relaunch(target: string, lane: LaneInfo, phase: string): Promise<number> {
	const notes: Array<string> = []
	const result = await lane_relaunch.resume(lane, phase, (note) => {
		notes.push(note)
	})

	if (result.kind !== 'launched') return report_relaunch_failure(target, result.note)

	if (notes.length > 0) console.error(notes.join('\n'))

	return report_relaunched_cut()
}

const { is_lane_branch } = run_cut_ready
const { declined } = run_cut_decline

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

	const base = {
		issue: request.issue,
		branch: request.branch,
		phase: request.phase,
		handoff: loaded.handoff,
	}
	// The checkout, not `target`: the record lives in the temp root, and the transcript is filed by checkout.
	const checkout = await run_cut.worktree_directory()
	const spec = run_cut.with_digest(base, () => run_cut_digest.own_digest(checkout))

	const spec_note =
		spec_refusal(spec) ?? (await run_cut_review.unrecorded_refusal(request, loaded.handoff))

	if (spec_note !== undefined) return report_bad_handoff(spec_note)
	if (run_cut.begin_cut(target, spec) === undefined) return report_cut_exists(target)

	await emit_cut_event(request)

	return undefined
}

async function finish_cut(target: string, lane: LaneInfo, request: CutRequest): Promise<number> {
	const refused = await write_cut(target, request)

	if (refused !== undefined) return refused

	return lane_relaunch.is_openai_lane(lane)
		? report_relaunched_cut()
		: await relaunch(target, lane, request.phase)
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

	if (state.held_issue !== request.issue) {
		return await declined(request, state, report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE))
	}

	if (!(await is_lane_branch(state))) return await declined(request, state, refuse_unready(state))

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

	if (!(await is_lane_branch(state))) {
		return await declined({ issue, phase }, state, refuse_unready(state))
	}

	const answered = await pre_gate_answer(issue, phase)

	if (answered !== undefined) return answered

	clear_expired(target)
	if (!has_matching_supervisor(lane, issue)) return report_missing_supervisor(issue)

	return await finish_cut(target, lane, { issue, branch: state.branch, phase, handoff_path })
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

	if (request.kind === 'resume') return await run_cut_resume.resume(target, request.issue)

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
	NOT_A_LANE_VERDICT,
	OVER_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	SPLIT_UNRESOLVED_VERDICT,
	UNDER_THRESHOLD_VERDICT,
	UNREADY_VERDICT,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_cut_cli }
