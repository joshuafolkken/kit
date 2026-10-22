import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from '#scripts/run/park/run-stalled'

// How many times a stopped ship relaunches its lane child before the issue goes to a person. A child
// that keeps stopping — the same red check, a finding it cannot close — would otherwise relaunch
// without end, one ship's cost each time, with nobody told (joshuafolkken/kit#3999).
//
// **The count is the issue's `ship-stop` events since its last fresh dispatch**: a relaunch into the
// lane emits no `child-launch`, a dispatch does, so a re-dispatched issue starts a new budget. The
// current stop is emitted before the count is read, so it is part of it. Past the cap the issue is
// parked with `run:stalled`, which every offer and the lane broker already refuse to start.
// The whole stream is read, not the run's carry scope: the count scopes itself by issue and dispatch,
// and a lane child shipping with no carry record (`lane:dispatch` outside a run, or a run already
// ended) would otherwise read no events and relaunch without a cap.

// One dispatch's own stops in the measured week reached five once and four or fewer otherwise, so four
// relaunches leave a ship that converges alone and stop the one that does not.
const MAX_SHIP_STOP_RELAUNCHES = 4
const PARK_CAUSE = 'ship-stop cap'
const { CHILD_LAUNCH, PARK, SHIP_STOP } = run_event_stream.EVENT_KIND

function stops_since_dispatch(events: ReadonlyArray<RunEvent>, issue: string): number {
	const own = events.filter((event) => run_event_scope.issue_named(event) === issue)
	const dispatched = own.findLastIndex((event) => event.kind === CHILD_LAUNCH)

	return own.slice(dispatched + 1).filter((event) => event.kind === SHIP_STOP).length
}

async function is_over(issue: string): Promise<boolean> {
	const events = await run_event_stream_emit.all_events()

	return stops_since_dispatch(events, issue) > MAX_SHIP_STOP_RELAUNCHES
}

function park_comment(issue: string, reason: string): string {
	return [
		`Parked by the \`josh ship\` supervisor: the ship stopped at \`${reason}\` after ${String(MAX_SHIP_STOP_RELAUNCHES)} relaunches of the lane child since its dispatch.`,
		'',
		`Read the stop with \`pnpm josh ship --log ${issue}\`, then ${run_stalled.next_step(issue)}.`,
	].join('\n')
}

// The label is what keeps the issue from being re-dispatched; without it the stop stays a plain stop,
// which `run:merge` books as an unanswered ship stop under its own outage cap.
async function park(issue: string, reason: string): Promise<boolean> {
	const park_write = await issue_park.apply(issue, RUN_STALLED_LABEL, park_comment(issue, reason))

	if (!park_write.is_labelled) return false

	const cite = issue_cite.plain(issue)

	await run_event_stream_emit.emit(PARK, run_stalled.park_event(issue, PARK_CAUSE))
	await telegram_notify.warn({
		issue_title: `Ship stop cap reached ${cite}`,
		body: `The lane child stopped at ${reason} more than ${String(MAX_SHIP_STOP_RELAUNCHES)} times since its dispatch, so it was not relaunched and the issue is parked.`,
		recovery: `Read pnpm josh ship --log ${issue}, then fix the cause and remove ${RUN_STALLED_LABEL} to offer it again.`,
	})

	return true
}

const run_ship_relaunch_cap = { MAX_SHIP_STOP_RELAUNCHES, is_over, park, stops_since_dispatch }

export { run_ship_relaunch_cap }
