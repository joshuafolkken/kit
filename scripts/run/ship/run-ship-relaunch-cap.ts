import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { issue_park } from '#scripts/issue/issue-park'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_stop_text } from './run-ship-stop-text'

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
//
// **Each kind of stop has its own cap** (joshuafolkken/kit#4707): a review stop (round 1 or round 2)
// and a mechanical one (gate, sync, commit, followup, conflict) are counted apart, so the review's
// back-and-forth never spends the relaunches a red CI run needs. The kind is read off the stop's text
// (`run-ship-stop-text.ts`); a text with no stage reads as mechanical.

// One dispatch's own stops in the measured week reached five once and four or fewer otherwise, so four
// relaunches leave a ship that converges alone and stop the one that does not.
const MAX_SHIP_STOP_RELAUNCHES = 4
const PARK_CAUSE = 'ship-stop cap'
const { CHILD_LAUNCH, PARK, SHIP_STOP } = run_event_stream.EVENT_KIND
const STOP_KIND = { REVIEW: 'review', MECHANICAL: 'mechanical' } as const
const REVIEW_REASONS: ReadonlySet<string> = new Set([
	run_ship_stage.STAGE.REVIEW,
	run_ship_stage.STAGE.ROUND_TWO,
])

type StopKind = (typeof STOP_KIND)[keyof typeof STOP_KIND]

function kind_of(reason: string | undefined): StopKind {
	return reason !== undefined && REVIEW_REASONS.has(reason)
		? STOP_KIND.REVIEW
		: STOP_KIND.MECHANICAL
}

function is_stop_of(event: RunEvent, kind: StopKind): boolean {
	return event.kind === SHIP_STOP && kind_of(run_ship_stop_text.reason_of(event.text)) === kind
}

function stops_since_dispatch(
	events: ReadonlyArray<RunEvent>,
	issue: string,
	kind: StopKind,
): number {
	const own = events.filter((event) => run_event_scope.issue_named(event) === issue)
	const dispatched = own.findLastIndex((event) => event.kind === CHILD_LAUNCH)

	return own.slice(dispatched + 1).filter((event) => is_stop_of(event, kind)).length
}

// `reason` is the current stop's; only the stops of its kind are counted.
async function is_over(issue: string, reason: string): Promise<boolean> {
	const events = await run_event_stream_emit.all_events()

	return stops_since_dispatch(events, issue, kind_of(reason)) > MAX_SHIP_STOP_RELAUNCHES
}

// `blocked` is what a timed-out merge wait was still blocked on (`run-ship-stop-cause.ts` →
// `blocked_cause_of`); it leads the comment and replaces the generic cause, so `run:board` names it.
function park_comment(issue: string, reason: string, blocked: string | undefined): string {
	return [
		`Parked by the \`josh ship\` supervisor: the ship stopped at \`${reason}\` after ${String(MAX_SHIP_STOP_RELAUNCHES)} relaunches of the lane child for ${kind_of(reason)} stops since its dispatch — the ${kind_of(reason)} stop cap was exceeded.`,
		...(blocked === undefined ? [] : ['', `Cause: \`${blocked}\``]),
		'',
		`Read the stop with \`pnpm josh ship --log ${issue}\`, then ${run_stalled.next_step(issue)}.`,
	].join('\n')
}

// The label is what keeps the issue from being re-dispatched; without it the stop stays a plain stop,
// which `run:merge` books as an unanswered ship stop under its own outage cap.
async function park(issue: string, reason: string, blocked?: string): Promise<boolean> {
	const comment = park_comment(issue, reason, blocked)
	const park_write = await issue_park.apply(issue, RUN_STALLED_LABEL, comment)

	if (!park_write.is_labelled) return false

	const cite = issue_cite.plain(issue)

	await run_event_stream_emit.emit(PARK, run_stalled.park_event(issue, blocked ?? PARK_CAUSE))
	await telegram_notify.warn({
		issue_title: `Ship stop cap reached ${cite}`,
		body: `The lane child's ${kind_of(reason)} stops passed their cap of ${String(MAX_SHIP_STOP_RELAUNCHES)} relaunches since its dispatch, the last at ${reason}, so it was not relaunched and the issue is parked.`,
		recovery: `Read pnpm josh ship --log ${issue}, then fix the cause and remove ${RUN_STALLED_LABEL} to offer it again.`,
	})

	return true
}

const run_ship_relaunch_cap = {
	MAX_SHIP_STOP_RELAUNCHES,
	STOP_KIND,
	is_over,
	kind_of,
	park,
	stops_since_dispatch,
}

export { run_ship_relaunch_cap }
