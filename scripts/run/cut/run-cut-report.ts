import { run_cut, type CutState, type RunCut } from './run-cut'
import { run_cut_handoff } from './run-cut-handoff'

// The verdict tokens `josh run:cut` answers with and the reports that print them, kept apart from
// `run-cut-cli.ts` so the CLI keeps to acting on the record. **Standard output carries exactly one
// token** and every explanation goes to standard error.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

const CUT_VERDICT = 'cut'
const RESUME_VERDICT = 'resume'
// An implementation-phase resume: the fresh process continues implementing rather than going to the
// gate. It is a distinct token so the resuming child branches on it without re-reading the record.
const RESUME_IMPL_VERDICT = 'resume-impl'
const FRESH_VERDICT = 'fresh'
// The current context is under the shared cut threshold, so the pre-gate cut was not worth its
// resume and nothing was cut. A benign, non-failing answer: the run carries
// on to the gate itself, exactly as `not-a-lane` does.
const UNDER_THRESHOLD_VERDICT = 'under-threshold'
const STALE_VERDICT = 'stale'
// The record matched the tree but carried no instruction to resume on, so the run was refused rather
// than continued blind to what it was told to do.
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
// The asking session is over the shared context-cut threshold, so an implementation cut was not
// resumed into it — the same refusal `run:carry` answers `over` with.
const OVER_VERDICT = 'over'

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
// without what it was told to do.
function report_incomplete(cut_record: RunCut): number {
	console.error(run_cut.incomplete_message(cut_record))

	return report(INCOMPLETE_VERDICT, FAILURE_EXIT_CODE)
}

// The `--handoff` file parsed but the assembled record would not fit the byte bound — the scalar fields
// carry a handoff that fit alone past the cap.
const HANDOFF_OVERFLOW_NOTE = '--handoff <path> would grow the cut record past its byte bound'
// An implementation cut resumes into implementation, and that resume refuses a record with no
// instruction (`incomplete`) — so the cut is refused here instead of relaunching a successor that can
// only stop.
const HANDOFF_MISSING_NOTE = 'this cut resumes into implementation and needs --handoff <path>'

function report_bad_handoff(note: string): number {
	console.error(
		`${note}. Nothing was cut; write the handoff file at ${run_cut_handoff.HANDOFF_PATH} and reissue.`,
	)

	return report(BAD_HANDOFF_VERDICT, FAILURE_EXIT_CODE)
}

// A successor already resumed this cut; a process woken after its own hand-off is told to stop rather
// than to investigate. It is a benign, non-failing stop.
function report_handed_off(cut_record: RunCut): number {
	console.error(run_cut.handed_off_message(cut_record))

	return report(HANDED_OFF_VERDICT, SUCCESS_EXIT_CODE)
}

function report_unreadable(): number {
	console.error(run_cut.unreadable_message())

	return report(UNREADABLE_VERDICT, FAILURE_EXIT_CODE)
}

// `unknown` with the reason it was answered: nothing was established, so nothing may be concluded.
function report_fault(message: string): number {
	console.error(message)

	return report(UNKNOWN_VERDICT, FAILURE_EXIT_CODE)
}

function report_unknown(): number {
	return report_fault(run_cut.unknown_message())
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
		'The current context is under the shared cut threshold, so nothing was cut; a resume would cost more than the accumulation it would drop. Continue to the gate.',
	)

	return report(UNDER_THRESHOLD_VERDICT, SUCCESS_EXIT_CODE)
}

// **A ship reviewer takes no cut, of either phase** (joshuafolkken/kit#3623). Its supervisor is waiting
// on the findings file it has yet to write, so a relaunch would stand a second child in the lane beside
// the one the supervisor repairs with. Answered `not-a-lane`, the verdict that already means "nothing
// was cut and this process carries on".
function report_reviewer(): number {
	console.error(
		'This session is a ship reviewer, which its supervisor is waiting on, so nothing was cut and nothing was relaunched. Write the findings file and finish the review in this process.',
	)

	return report(NOT_A_LANE_VERDICT, SUCCESS_EXIT_CODE)
}

// **An implementation cut is never resumed by a session over the threshold**.
// The cut outside a lane leaves the session that took it open, so a person retyping `fullrun #N` there
// would be answered `resume-impl`, keep implementing over the threshold, and be cut again on the next
// edit — a loop that sheds no context. The record is left intact for a fresh session.
function report_over(): number {
	console.error(
		'This session is over the shared context-cut threshold (`pnpm josh cost --cut` answers `over`), so the implementation cut was not resumed here and its record is kept. End this conversation and type the invocation again in a fresh session.',
	)

	return report(OVER_VERDICT, FAILURE_EXIT_CODE)
}

const run_cut_report = {
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
	UNKNOWN_VERDICT,
	UNREADABLE_VERDICT,
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
}

export { run_cut_report }
