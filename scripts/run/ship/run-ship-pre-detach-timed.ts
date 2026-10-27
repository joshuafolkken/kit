import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship_pre_detach, type PreDetachResult } from './run-ship-pre-detach'
import { run_ship_stage, type Phase } from './run-ship-stage'

// The pre-detach checks, timed into the lane ledger and marked on the event stream as a ship stage
// is, so their minutes are no longer folded into the lane's implementation time
// (joshuafolkken/kit#4382). They are not a `Stage`: nothing resumes past them, and `run:board` draws no
// phase from a word it does not know.

const SUCCESS_EXIT_CODE = 0
const { PHASE } = run_ship_stage

async function emit_phase(issue: string, phase: Phase): Promise<void> {
	const text = run_ship_stage.event_text(issue, lane_ledger_write.PRE_DETACH_STAGE, phase)

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.SHIP_STAGE, text)
}

async function checks(
	issue: string,
	run: () => Promise<PreDetachResult> = run_ship_pre_detach.checks,
): Promise<PreDetachResult> {
	await emit_phase(issue, PHASE.START)
	const started_ms = performance.now()
	const result = await run()
	const elapsed_ms = performance.now() - started_ms

	await lane_ledger_write.record_stage({
		stage: lane_ledger_write.PRE_DETACH_STAGE,
		elapsed_ms,
		issue: Number(issue),
	})
	await emit_phase(issue, result.code === SUCCESS_EXIT_CODE ? PHASE.DONE : PHASE.FAILED)

	return result
}

const run_ship_pre_detach_timed = { checks }

export { run_ship_pre_detach_timed }
