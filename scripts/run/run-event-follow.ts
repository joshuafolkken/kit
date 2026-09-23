import type { StreamRead } from './run-event-stream'

// The follow read behind `josh run:event --follow` (joshuafolkken/kit#2207). A session attached to a
// terminal relays the run's event stream by asking "everything since the position I last read" — and
// it must relay **both** on a new event's arrival, promptly, and on the interval when nothing new has
// happened, so a person watching sees progress land at once and still sees the run is alive when it is
// quiet.
//
// **This is one bounded pass, not the loop.** It returns as soon as any event is past the caller's
// position (the arrival relay), or when the interval elapses having found none (the quiet tick); the
// caller relays what came back and asks again from the returned position. The session drives the loop —
// a background pass whose exit re-invokes it is what delivers the next turn (`background-commands.md`),
// exactly as `run:progress --wait` is driven — so no clock is kept here.
//
// **It reads the run's stream, not a session's.** `read` is `run_event_stream.read_from` bound to the
// run-keyed target, and the position is the caller's own, so the pass answers the same before and after
// a `backlogrun` session cut: a cut changes who executes, never what the stream says or where a reader
// stands in it. That invariant is the point of the whole issue, and it is why this takes ports rather
// than resolving a target itself — the test drives it with a stream it controls and a clock it advances.
//
// **It is a poll, and deliberately not `run:progress`'s loop.** That one reads GitHub observations and
// exits on a silence interval; this one reads the appended stream and exits on a position advancing.
// The shapes rhyme, but the data source and the exit condition are different, so folding them together
// would couple two unrelated readers rather than remove a duplicate.

// The follow's quiet-tick cadence and how promptly it notices an arrival. The interval only bounds a
// wait that found nothing — an arrival returns within a tick of landing — so it can be as long as the
// heartbeat without making the relay late, and the tick is a cheap `stat` of one file. They live here
// rather than in the CLI because the relay guard (`run-watcher-guard.ts`) measures a relay's staleness
// against the same interval, so the two cannot disagree about how long one pass may be quiet
// (joshuafolkken/kit#2437).
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const FOLLOW_INTERVAL_MINUTES = 20
const FOLLOW_INTERVAL_MS = FOLLOW_INTERVAL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND
const FOLLOW_TICK_MS = MS_PER_SECOND

interface FollowPorts {
	read: (position: number) => StreamRead
	now: () => number
	sleep: (milliseconds: number) => Promise<void>
}

interface FollowOptions {
	interval_ms: number
	tick_ms: number
}

// Everything past `position`, returned the moment it exists or when the interval runs out. `deadline`
// is fixed once from the start, so the wait is the interval and not the interval per empty tick.
async function follow(
	ports: FollowPorts,
	position: number,
	options: FollowOptions,
): Promise<StreamRead> {
	const deadline = ports.now() + options.interval_ms
	let read = ports.read(position)

	while (read.events.length === 0 && ports.now() < deadline) {
		await ports.sleep(options.tick_ms)
		read = ports.read(position)
	}

	return read
}

const run_event_follow = { FOLLOW_INTERVAL_MS, FOLLOW_TICK_MS, follow }

export type { FollowOptions, FollowPorts }
export { run_event_follow }
