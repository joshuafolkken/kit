import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import type { LaneSpan } from './lane-net-time'

// The network outages `lane-offline.ts` records (joshuafolkken/kit#7867), read back from its `offline` /
// `online` turns. Apart from the recorder, so `lane-host-gaps.ts` reads them without reaching the
// stream's writer.
//
// Every tick still offline writes an `offline-tick`, so an outage ends at its recovery or one tick past
// the last tick that saw it, whichever is first: a drive that stopped (or crashed) mid-outage leaves it
// closed where its sampler last looked, never open across the lanes that came after.

const { EVENT_KIND } = run_event_stream

// The load sampler's tick (`lane-sampler.ts`), owned here so an outage's bound and the probe's period
// cannot drift apart.
const SAMPLE_INTERVAL_MS = 60_000
const STALE_TICKS = 2
const STALE_MS = SAMPLE_INTERVAL_MS * STALE_TICKS

interface Outage {
	from_ms: number
	// The last tick that saw the network down.
	down_ms: number
	up_ms?: number
}

function open_of(kept: ReadonlyArray<Outage>): Outage | undefined {
	const last = kept.at(-1)

	return last?.up_ms === undefined ? last : undefined
}

// A sighting two ticks or more after the open outage's last one is a new outage: the drive that saw the
// old one stopped, and the old one stays bounded at its own last sighting.
function continues(open: Outage | undefined, ms: number): open is Outage {
	return open !== undefined && ms - open.down_ms < STALE_MS
}

function on_down(kept: Array<Outage>, ms: number): void {
	const open = open_of(kept)

	if (continues(open, ms)) open.down_ms = ms
	else kept.push({ from_ms: ms, down_ms: ms })
}

function on_up(kept: Array<Outage>, ms: number): void {
	const open = open_of(kept)

	if (open !== undefined) open.up_ms = ms
}

const ON_TURN: ReadonlyMap<string, (kept: Array<Outage>, ms: number) => void> = new Map([
	[EVENT_KIND.OFFLINE, on_down],
	[EVENT_KIND.OFFLINE_TICK, on_down],
	[EVENT_KIND.ONLINE, on_up],
])

function span_of(outage: Outage): LaneSpan {
	const bound_ms = outage.down_ms + SAMPLE_INTERVAL_MS

	return { from_ms: outage.from_ms, to_ms: Math.min(outage.up_ms ?? bound_ms, bound_ms) }
}

function outages_of(events: ReadonlyArray<RunEvent>): Array<Outage> {
	const kept: Array<Outage> = []

	for (const event of events) ON_TURN.get(event.kind)?.(kept, Date.parse(event.at))

	return kept
}

/** Every outage on `events`, oldest first, each ending at its recovery or a tick past its last sighting. */
function spans(events: ReadonlyArray<RunEvent>): Array<LaneSpan> {
	return outages_of(events).map((outage) => span_of(outage))
}

/** The outage `events` leave with no recovery; `undefined` while the network is up. */
function open_outage(events: ReadonlyArray<RunEvent>): Outage | undefined {
	return open_of(outages_of(events))
}

/**
 * Whether `outage` is still being seen at `now_ms`: past two ticks with no sighting, the drive that saw
 * it stopped, so it says nothing about the network now.
 */
function is_current(outage: Outage, now_ms: number): boolean {
	return continues(outage, now_ms)
}

/** Whether `kind` is one of the connection turns, which are not the run's own activity. */
function is_turn(kind: string): boolean {
	return ON_TURN.has(kind)
}

/** Whether `events` last left the network up; no turn at all reads as up. */
function ends_online(events: ReadonlyArray<RunEvent>): boolean {
	const turn = events.findLast(
		(event) => event.kind === EVENT_KIND.OFFLINE || event.kind === EVENT_KIND.ONLINE,
	)

	return turn?.kind !== EVENT_KIND.OFFLINE
}

const lane_offline_spans = {
	SAMPLE_INTERVAL_MS,
	ends_online,
	is_current,
	is_turn,
	open_outage,
	spans,
}

export { lane_offline_spans }
export type { Outage }
