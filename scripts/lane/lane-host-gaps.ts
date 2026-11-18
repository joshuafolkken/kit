import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LaneSpan } from './lane-net-time'
import { lane_offline_spans } from './lane-offline-spans'

// The intervals the whole host stopped (joshuafolkken/kit#7866): every lane stood still through them,
// whatever its issue, so no lane's time counts them: the host's sleeps (joshuafolkken/kit#5032,
// recorded by `lane-sleep.ts`) and its network outages (joshuafolkken/kit#7867, `lane-offline.ts`),
// joined so a sleep while offline counts once. `josh lane:net` (`lane-net-time.ts`) and the board's time column
// (`run-board-lane-time.ts`) both take them out through here.

const { EVENT_KIND } = run_event_stream

// Every sleep on `events`, oldest first: a `sleep` event is stamped at the wake and carries its length.
function sleeps(events: ReadonlyArray<RunEvent>): Array<LaneSpan> {
	return events
		.filter((event) => event.kind === EVENT_KIND.SLEEP)
		.map((event) => {
			const to_ms = Date.parse(event.at)

			return { from_ms: to_ms - (event.elapsed_ms ?? 0), to_ms }
		})
}

// `spans` oldest first with every overlap joined, so an interval two of them cover is counted once.
function joined(spans: ReadonlyArray<LaneSpan>): Array<LaneSpan> {
	const sorted = spans.toSorted((left, right) => left.from_ms - right.from_ms)

	const kept: Array<LaneSpan> = []

	for (const next of sorted) {
		const last = kept.at(-1)

		if (last === undefined || next.from_ms > last.to_ms) kept.push({ ...next })
		else last.to_ms = Math.max(last.to_ms, next.to_ms)
	}

	return kept
}

/** Every interval the host stopped on `events`, joined; an open outage ends a tick past its last sighting. */
function gaps_of(events: ReadonlyArray<RunEvent>): Array<LaneSpan> {
	return joined([...sleeps(events), ...lane_offline_spans.spans(events)])
}

/** `gaps` cut to `span` and joined. */
function within(gaps: ReadonlyArray<LaneSpan>, span: LaneSpan): Array<LaneSpan> {
	const cut = gaps.map((gap) => ({
		from_ms: Math.max(gap.from_ms, span.from_ms),
		to_ms: Math.min(gap.to_ms, span.to_ms),
	}))

	return joined(cut.filter((gap) => gap.to_ms > gap.from_ms))
}

function length_ms(spans: ReadonlyArray<LaneSpan>): number {
	return spans.reduce((total, span) => total + span.to_ms - span.from_ms, 0)
}

/** How long the host stopped inside `spans`, each counted on its own. */
function excluded_ms(gaps: ReadonlyArray<LaneSpan>, spans: ReadonlyArray<LaneSpan>): number {
	return spans.reduce((total, span) => total + length_ms(within(gaps, span)), 0)
}

const lane_host_gaps = { excluded_ms, gaps_of, joined, length_ms, sleeps, within }

export { lane_host_gaps }
