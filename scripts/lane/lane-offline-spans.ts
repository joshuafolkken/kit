import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LaneSpan } from './lane-net-time'

// The network outages `lane-offline.ts` records (joshuafolkken/kit#7867), read back from its `offline` /
// `online` turns. Apart from the recorder, so `lane-host-gaps.ts` reads them without reaching the
// stream's writer.

const { EVENT_KIND } = run_event_stream

const TURNS_PER_SPAN = 2

// An outage still open when the events end; `lane_host_gaps.within` cuts it at the span it is asked for.
const OPEN_MS = Infinity

function is_turn(event: RunEvent): boolean {
	return event.kind === EVENT_KIND.OFFLINE || event.kind === EVENT_KIND.ONLINE
}

function state_of(turns: ReadonlyArray<RunEvent>): string {
	return turns.at(-1)?.kind ?? EVENT_KIND.ONLINE
}

// The turns that changed the state, starting from online: a repeat (two drives' samplers) is dropped.
function changes(events: ReadonlyArray<RunEvent>): Array<RunEvent> {
	const kept: Array<RunEvent> = []

	for (const event of events) {
		if (is_turn(event) && event.kind !== state_of(kept)) kept.push(event)
	}

	return kept
}

function time_of(event: RunEvent | undefined): number {
	return event === undefined ? OPEN_MS : Date.parse(event.at)
}

/** Every outage on `events`, oldest first; one still open ends at `Infinity`. */
function spans(events: ReadonlyArray<RunEvent>): Array<LaneSpan> {
	const turns = changes(events)

	return turns
		.filter((_, index) => index % TURNS_PER_SPAN === 0)
		.map((down, index) => ({
			from_ms: Date.parse(down.at),
			to_ms: time_of(turns[index * TURNS_PER_SPAN + 1]),
		}))
}

/** Whether `events` last left the network up; no turn at all reads as up. */
function ends_online(events: ReadonlyArray<RunEvent>): boolean {
	return state_of(changes(events)) === EVENT_KIND.ONLINE
}

const lane_offline_spans = { ends_online, spans }

export { lane_offline_spans }
