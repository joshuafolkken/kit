import { issue_cite } from '#scripts/issue/issue-cite'
import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import type { ParkStop } from '#scripts/run/park/run-stalled'
import { run_stalled_park } from '#scripts/run/park/run-stalled-park'
import { run_ship_park_prose } from './run-ship-park-prose'
import { run_ship_stage } from './run-ship-stage'
import { run_ship_stop_cause } from './run-ship-stop-cause'
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
const TIMEOUT_PARK_CAUSE = 'merge-wait timeout'
const CI_INFRA_PARK_CAUSE = 'CI infrastructure failure'
const { CI_INFRA } = run_ship_stop_cause.CAUSE
const { CHILD_LAUNCH, SHIP_STOP } = run_event_stream.EVENT_KIND
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

// A CI-infrastructure stop spends no relaunch: it parks at once, and its resume is a re-run once CI
// recovers, which must not find the cap spent (joshuafolkken/kit#6848).
function is_capped_stop(text: string): boolean {
	return run_ship_stop_text.cause_of(text) !== CI_INFRA
}

function is_stop_of(event: RunEvent, kind: StopKind): boolean {
	if (event.kind !== SHIP_STOP || !is_capped_stop(event.text)) return false

	return kind_of(run_ship_stop_text.reason_of(event.text)) === kind
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

// Why the issue is parked: the comment's lead line, the park event's cause, and the warning's title and body.
interface ParkNotice {
	lead: string
	cause: string
	title: string
	body: string
}

// The stop being parked: its reason (the stage, or `conflict`) the comment names, the ship stop the
// park event records, and what a timed-out merge wait was still blocked on.
interface ParkedStop {
	reason: string
	stop: ParkStop
	blocked?: string | undefined
}

// `blocked` is what a timed-out merge wait was still blocked on (`run-ship-stop-cause.ts` →
// `blocked_cause_of`); it leads the comment and replaces the generic cause, so `run:board` names it.
function park_comment(issue: string, lead: string, blocked: string | undefined): string {
	return [
		lead,
		...(blocked === undefined ? [] : ['', `Cause: \`${blocked}\``]),
		'',
		run_ship_park_prose.next_step(issue),
	].join('\n')
}

// The label is what keeps the issue from being re-dispatched; without it the stop stays a plain stop,
// which `run:merge` books as an unanswered ship stop under its own outage cap.
// The park event keeps the ship stop beside its text (joshuafolkken/kit#6864), read back with
// `run_stalled.stop_of`; the text, which `run:board` reads, is unchanged.
async function park_with(issue: string, notice: ParkNotice, parked: ParkedStop): Promise<boolean> {
	const { blocked, stop } = parked
	const comment = park_comment(issue, notice.lead, blocked)
	const is_parked = await run_stalled_park.apply(issue, comment, blocked ?? notice.cause, { stop })

	if (!is_parked) return false

	await telegram_notify.warn({
		issue_title: `${notice.title} ${issue_cite.plain_for('telegram', issue)}`,
		body: notice.body,
		recovery: `Read pnpm josh ship --log ${issue}, then fix the cause and remove ${RUN_STALLED_LABEL} to offer it again.`,
	})

	return true
}

async function park(issue: string, parked: ParkedStop): Promise<boolean> {
	const { reason } = parked
	const prose = run_ship_park_prose.cap({
		reason,
		kind: kind_of(reason),
		relaunches: String(MAX_SHIP_STOP_RELAUNCHES),
	})

	return await park_with(
		issue,
		{ ...prose, cause: PARK_CAUSE, title: 'Ship stop cap reached' },
		parked,
	)
}

// A timed-out merge wait parks at once: a relaunch waits the same timeout on the same blocked merge
// (joshuafolkken/kit#5775).
async function park_timed_out(issue: string, parked: ParkedStop): Promise<boolean> {
	const prose = run_ship_park_prose.timed_out(parked.reason)

	return await park_with(
		issue,
		{ ...prose, cause: TIMEOUT_PARK_CAUSE, title: 'Merge wait timed out' },
		parked,
	)
}

// A followup whose CI-infrastructure reruns ran out parks at once: a relaunch meets the same outage, and
// a re-run once CI recovers resumes it (joshuafolkken/kit#6848).
async function park_ci_infra(issue: string, parked: ParkedStop): Promise<boolean> {
	const prose = run_ship_park_prose.ci_infra(parked.reason)

	return await park_with(
		issue,
		{ ...prose, cause: CI_INFRA_PARK_CAUSE, title: CI_INFRA_PARK_CAUSE },
		parked,
	)
}

// The park of a stop that parks at once (`run-ship-stop-cause.ts` → `parks_at_once`), by its cause.
async function park_at_once(issue: string, parked: ParkedStop): Promise<boolean> {
	if (parked.stop.cause === CI_INFRA) return await park_ci_infra(issue, parked)

	return await park_timed_out(issue, parked)
}

const run_ship_relaunch_cap = {
	MAX_SHIP_STOP_RELAUNCHES,
	STOP_KIND,
	is_over,
	kind_of,
	park,
	park_at_once,
	park_timed_out,
	stops_since_dispatch,
}

export { run_ship_relaunch_cap }
export type { ParkedStop }
