#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { git_command } from '#scripts/git/git-command'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_dispatch } from '#scripts/lane/lane-dispatch'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { detached_launch } from './detached-launch'
import { run_cut, type CutState, type RunCut } from './run-cut'
import { run_cut_args, type Request } from './run-cut-args'

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
const FRESH_VERDICT = 'fresh'
const STALE_VERDICT = 'stale'
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

function relaunch(target: string, lane: LaneInfo, invocation: string): number {
	const notes: Array<string> = []
	const result = detached_launch.launch(
		{
			argv: detached_launch.agent_argv(invocation),
			cwd: lane.directory,
			log_path: lane_dispatch.default_log_path(lane),
			// The relaunch keeps the mark, so the resumed child is still a dispatched child to every rule
			// that reads it (joshuafolkken/kit#1904); the inherited environment cannot be relied on here,
			// since the parent-session strip runs on the way in.
			env: lane_child_marker.env_for(lane.issue),
		},
		(note) => {
			notes.push(note)
		},
	)

	if (result.kind === 'failed') return report_relaunch_failure(target, result.note)

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

async function cut(target: string, issue: string): Promise<number> {
	const lane = await lane_registry.find_open_lane(issue)

	if (lane === undefined) return report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE)

	const state = await run_cut.current_state()

	if (!(await is_lane_branch(state))) return refuse_unready(state)

	clear_expired(target)
	const started = run_cut.begin_cut(target, { issue, branch: state.branch })

	if (started === undefined) return report_cut_exists(target)

	return relaunch(target, lane, started.invocation)
}

// **The adoption is the resume-uniqueness guarantee**: it removes and creates exclusively, so of two
// racing resumes only one wins the create and the loser is answered `busy`.
function adopt(target: string, cut_record: RunCut): number {
	const adopted = run_cut.adopt_cut(target, cut_record)

	if (adopted === undefined) return report_busy(cut_record)

	return report(RESUME_VERDICT, SUCCESS_EXIT_CODE)
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

	if (verdict === 'stale') return report_stale(cut_record)

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

async function act(target: string, request: Request): Promise<number> {
	if (request.kind === 'cut') return await cut(target, request.issue)

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
	BUSY_VERDICT,
	CUT_VERDICT,
	ENDED_VERDICT,
	FAILED_VERDICT,
	FRESH_VERDICT,
	NOT_A_LANE_VERDICT,
	RESUME_VERDICT,
	STALE_VERDICT,
	UNKNOWN_VERDICT,
	UNREADABLE_VERDICT,
	UNREADY_VERDICT,
	USAGE: run_cut_args.USAGE,
	main,
	run,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_cut_cli }
