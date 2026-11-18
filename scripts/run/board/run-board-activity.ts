import { lane_offline_spans } from '#scripts/lane/lane-offline-spans'
import type { PrChecks } from '#scripts/run/event/run-event-checks'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_checks } from './run-board-checks'
import { run_board_events_memo, type EventsMemo } from './run-board-events-memo'
import { run_board_lane_event, type LaneEvent } from './run-board-lane-event'
import { run_board_setup, type SetupRead } from './run-board-setup'

// What the run as a whole is doing, read off its own event stream for the board's header — the
// per-child half is `run-board-status.ts`'s.

interface LatestEvent {
	text: string
	at_ms: number
}

// The run as a whole, read off the same stream. The setup half is `run-board-setup.ts`'s, absent
// where a stream carries no stage.
interface RunActivity extends Partial<SetupRead> {
	// Runtime evidence for the stage, independent of its retained description.
	is_setup_working?: boolean | undefined
	// The newest event's time, the connection turns aside (`lane-offline-spans.ts`): a recovery is no
	// sign of the run's own life, so counting it would hide a hang behind an outage.
	last_event_ms: number | undefined
	// When the outage the stream still leaves open began (joshuafolkken/kit#7895); absent while online.
	offline_since_ms?: number | undefined
	// The newest thing the run did — its newest position, or its newest event where it has none yet —
	// in the event's own words, and when.
	latest?: LatestEvent | undefined
	// When the run last did anything of its own — its newest position or stage, whichever is newer. A
	// stage that has ended still counts: what follows it is counted from its end, not from before it.
	idle_ms?: number | undefined
	// Each child's newest `lane-phase` or `ship-stage`, by issue (`run-board-lane-event.ts`).
	lane_events?: ReadonlyMap<number, LaneEvent> | undefined
	// Each child's newest `pr-checks`, by issue (`run-board-checks.ts`).
	pr_checks?: ReadonlyMap<number, PrChecks> | undefined
	// The newest session's start until its first lane opened (`run-board-first-lane.ts`).
	first_lane_ms?: number | undefined
	// The run's last position is a `stop` that names no child — the run itself ended.
	is_stopped: boolean
}

const KIND = run_event_stream.EVENT_KIND

function moment(event: RunEvent): number {
	return Date.parse(event.at)
}

function is_run_stop(event: RunEvent | undefined): boolean {
	return event?.kind === KIND.STOP && run_event_scope.issue_named(event) === undefined
}

function latest_of(event: RunEvent | undefined): LatestEvent | undefined {
	return event === undefined ? undefined : { text: event.text, at_ms: moment(event) }
}

function is_own(event: RunEvent): boolean {
	return event.kind === KIND.SETUP || !run_event_stream.TRACE_KINDS.has(event.kind)
}

// A stream of traces alone has done nothing of its own yet, so its newest event stands in.
function idle_of(events: ReadonlyArray<RunEvent>): number | undefined {
	const own = events.findLast((event) => is_own(event)) ?? events.at(-1)

	return own === undefined ? undefined : moment(own)
}

function stream_activity(events: ReadonlyArray<RunEvent>): RunActivity {
	const last = events.findLast((event) => !lane_offline_spans.is_turn(event.kind))
	const position = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return {
		...run_board_setup.read(events),
		last_event_ms: last === undefined ? undefined : moment(last),
		offline_since_ms: lane_offline_spans.open_since(events),
		latest: latest_of(position ?? last),
		idle_ms: idle_of(events),
		lane_events: run_board_lane_event.newest_of(events),
		pr_checks: run_board_checks.newest_of(events),
		first_lane_ms: run_event_setup.first_lane_ms(events),
		is_stopped: is_run_stop(position),
	}
}

const ACTIVITIES: EventsMemo<RunActivity> = new WeakMap()

// `is_ended` is a run `run:carry --end` closed: its record says it stopped, whatever its last event
// was.
function activity_of(events: ReadonlyArray<RunEvent>, is_ended = false): RunActivity {
	const activity = run_board_events_memo.remembered(ACTIVITIES, events, stream_activity)

	return is_ended ? { ...activity, is_stopped: true } : activity
}

const run_board_activity = { activity_of }

export { run_board_activity }
export type { LatestEvent, RunActivity }
