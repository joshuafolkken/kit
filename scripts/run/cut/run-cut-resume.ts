import { cost_cli } from '#scripts/cost-runtime/cost-cli'
import { cost_verdict } from '#scripts/cost-runtime/cost-verdict'
import { issue_cite } from '#scripts/issue/issue-cite'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_cut, type RunCut } from './run-cut'
import { run_cut_report } from './run-cut-report'
import { run_cut_review } from './run-cut-review'

// `josh run:cut --resume <N>` — a fresh process asking whether it resumes a cut: it verifies the tree
// against the record and adopts it, answering which phase it resumes into. Taking a cut is
// `run-cut-cli.ts`'s.

const {
	FRESH_VERDICT,
	HANDED_OFF_VERDICT,
	INCOMPLETE_VERDICT,
	RESUME_IMPL_VERDICT,
	RESUME_VERDICT,
	SUCCESS_EXIT_CODE,
	report,
	report_busy,
	report_handed_off,
	report_incomplete,
	report_over,
	report_stale,
	report_unreadable,
} = run_cut_report

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

	const verdict = resume_verdict_for(cut_record)

	await run_cut_review.announce_resume(cut_record, verdict === RESUME_IMPL_VERDICT)
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

const run_cut_resume = {
	resume,
}

export { run_cut_resume }
