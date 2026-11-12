import { issue_cite } from '#scripts/issue/issue-cite'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship_stage } from '#scripts/run/ship/run-ship-stage'

// **A merge is dated no later than its ship's report** (joshuafolkken/kit#6677): the ship merged the
// pull request in its `followup`, before its `report` stage ended, while `run:merge` confirms it only
// once the driver's pass reaches the child — a pass launching siblings holds that back for minutes.
// Dated at the confirmation alone, the wait sat in the lane's net time and after the siblings'
// dispatch. Only a report since the child's newest dispatch counts: an earlier lane's ship is not
// this one's.

const KIND = run_event_stream.EVENT_KIND

function is_own(event: RunEvent, cite: string): boolean {
	return event.text.startsWith(`${cite} `)
}

function is_report_done(event: RunEvent): boolean {
	if (event.kind !== KIND.SHIP_STAGE) return false

	const { stage, phase } = run_ship_stage.words_of(event.text)

	return stage === run_ship_stage.STAGE.REPORT && phase === run_ship_stage.PHASE.DONE
}

function is_bound(event: RunEvent): boolean {
	return event.kind === KIND.CHILD_LAUNCH || is_report_done(event)
}

// The newest report the child's ship finished since its dispatch, `undefined` where none did.
function reported_at(events: ReadonlyArray<RunEvent>, child: string): number | undefined {
	const cite = issue_cite.plain_for('program', child)
	const bound = events.findLast((event) => is_own(event, cite) && is_bound(event))

	return bound !== undefined && is_report_done(bound) ? Date.parse(bound.at) : undefined
}

function dated(events: ReadonlyArray<RunEvent>, child: string, confirmed_at: Date): Date {
	const reported = reported_at(events, child)

	if (reported === undefined || reported >= confirmed_at.getTime()) return confirmed_at

	return new Date(reported)
}

// **Put on record once**: a pass that collects a child already on record — `run:carry --end` after
// `run:merge` — writes neither again (joshuafolkken/kit#4734).
async function put_on_record(child: string, confirmed_at: Date): Promise<void> {
	const text = `${issue_cite.plain_for('program', child)} merged`
	const events = await run_event_stream_emit.invocation_or_all_events()

	if (events.some((event) => event.kind === KIND.MERGE && event.text === text)) return

	const at = dated(events, child, confirmed_at)

	await run_event_stream_emit.emit(KIND.MERGE, text, at)
	await lane_ledger_write.record_merge(Number(child), at)
}

const run_merge_dated = { dated, put_on_record }

export { run_merge_dated }
