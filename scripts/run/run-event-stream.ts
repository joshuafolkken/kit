import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

// The run's append-only, ordered event stream — the surface a reader who was away rebuilds the run's
// recent shape from (joshuafolkken/kit#2205). The report clock (`run-progress-clock.ts`) keeps only the
// *last* heartbeat, and its `.log` sibling keeps only heartbeat *lines* with no position; neither lets
// a woken reader ask "everything since the position I last read". This does.
//
// **The stream is keyed to the run's identity, not the work tree.** `run-carry.ts` keys the invocation's
// budget on the common git directory every lane of one repository shares, because one invocation opens
// lanes each with a work tree of its own; the same is true here — the parent session, a cut successor
// and every lane child are one run and append to one stream — so the emit side (`run-event-stream-emit.ts`)
// resolves the same key. This module stays pure: it is handed the resolved `target`, exactly as
// `run-progress-clock.ts`'s writers are.
//
// **Positions are stored, never renumbered.** Each event carries an explicit `pos` — the previous
// maximum plus one — so a reader holding position P still reads "everything after P" after the bound has
// dropped older events. Renumbering on compaction would silently shift a reader past unseen events.
//
// **The write is best-effort by contract, and the safety lives on the emit side.** The reporting path
// must never fail the work it reports on (joshuafolkken/kit#2205), so `run-event-stream-emit.ts` wraps
// every append in a swallow; this module is free to throw on a genuinely broken write.

const EVENT_PREFIX = 'josh-run-events-'
// `.jsonl` rather than `.json`: the file is one JSON event per line, appended to, and the suffix tells
// every reader — a person, an editor — that it is a line stream rather than a single document, the same
// distinction the ambient `.log` draws.
const EVENT_SUFFIX = '.jsonl'
// A run's session-facing events over the 8-hour whole-run bound: a plan, a launch/PR/review-round/merge
// per child across a few dozen children, plus parks, cuts and stops. Five hundred keeps the whole of a
// large `backlogrun` and still bounds an unattended run — past it the oldest events roll off, which is
// what the acceptance criteria pin.
const EVENT_CAP = 500
const FIRST_POSITION = 0
const POSITION_INCREMENT = 1
const LINE_SEPARATOR = '\n'

// **The one enumeration of what a session-facing event is** (joshuafolkken/kit#2205). Every writer names
// its event by one of these members rather than passing a free string, so the set of things the stream
// carries is defined here and nowhere else; `append` refuses a kind outside it, which is what keeps a
// caller from quietly widening the stream.
const EVENT_KIND = {
	PLAN: 'plan',
	CHILD_LAUNCH: 'child-launch',
	MERGE: 'merge',
	PARK: 'park',
	OUTAGE: 'outage',
	CUT: 'cut',
	// The backlog emptied while nothing of the run's own was in flight — the drain
	// (joshuafolkken/kit#2335). It marks the position at which the end-of-run retrospective is owed,
	// *before* the idle watch opens, so `run:step` fires the retrospective at the drain rather than after
	// the watch runs its course. It is not itself a stop: the run watches on once the retrospective has
	// run, and the real `STOP` follows when the watch expires.
	DRAIN: 'drain',
	STOP: 'stop',
	PR_OPENED: 'pr-opened',
	REVIEW_ROUND: 'review-round',
	// The end-of-run retrospective's result, recorded when the run marks the retrospective done
	// (joshuafolkken/kit#2342). A retrospective that files zero improvements and one that never ran look
	// the same from outside — no new Issue either way — so the result is put on the stream the report is
	// generated from: the issues filed (or that none were), and the candidates dropped with why. It is
	// emitted from the `run:carry --retrospective` close, so marking the retrospective done and recording
	// what it found are one action rather than two the run could do only one of.
	RETROSPECTIVE: 'retrospective',
	// Ready backlog work is sitting undispatched while a lane is free and nothing has dispatched for a
	// while (joshuafolkken/kit#2359). Emitted once per stall episode by the stop-time detector, it is
	// both the dedup marker — `emit_once_since` refuses a second until a `CHILD_LAUNCH` intervenes
	// (joshuafolkken/kit#2464) — and the line a
	// terminal reader following the stream sees. `run:step` reads it as `backlog:next`, so a run that
	// stalled is pointed straight at dispatching the work rather than left waiting.
	STALL: 'stall',
	// The run's own driver is gone: the cut handed the budget off, the owner has died, and no supervisor
	// is watching (joshuafolkken/kit#2375). Emitted once per strand episode by the stop-time detector,
	// exactly as `STALL` is — the newest-event dedup keeps a run polled every stop from notifying more
	// than once, and a terminal reader following the stream sees the line. The strand is the step before
	// the stall: a stalled run still has a driver that could dispatch, a stranded one has none.
	STRANDED: 'stranded',
	// One `josh ship` stage starting, succeeding or failing (joshuafolkken/kit#2426). It is a trace of the
	// composite's progress rather than a position the run is at — the positions a ship leaves behind are
	// the closed issue its `followup` merges, or a detached supervisor's `SHIP_LAUNCH` / `SHIP_STOP` below
	// — so it is one of the `TRACE_KINDS` the last-event read skips.
	SHIP_STAGE: 'ship-stage',
	// One progress watcher line — the `at … / next …` heartbeat `run:progress` prints
	// (joshuafolkken/kit#2437). Printed only to the watcher's own output, a headless successor's heartbeat
	// was buried in its log after a cut; on the stream it reaches the attached session's relay. It says
	// the run is alive rather than where it is, so it is a trace kind like `SHIP_STAGE`.
	HEARTBEAT: 'heartbeat',
	// The post-implementation region handed to a detached `josh ship --detach` supervisor
	// (joshuafolkken/kit#2428). Unlike a stage trace it is a position: the agent has ended and the
	// supervisor carries the run, so `run:step` answers `wait` until it stops or the issue closes.
	SHIP_LAUNCH: 'ship-launch',
	// The supervisor stopped at a failed stage — a red gate, a High/Medium review, a failed push, red CI
	// (joshuafolkken/kit#2428). The position that hands control back: `run:step` prints the command that
	// shows the stopped report, so the agent fixes it and relaunches rather than rebuilding the context.
	SHIP_STOP: 'ship-stop',
} as const

type EventKind = (typeof EVENT_KIND)[keyof typeof EVENT_KIND]

const EVENT_KINDS: ReadonlyArray<string> = Object.values(EVENT_KIND)

// The kinds that trace progress inside a step rather than mark where the run is. Every last-event reader
// — `run:step`'s position, the setup-cut hook, `emit_once`'s dedup — asks "where is the run", and a
// ship's four stage lines after its `merge` would otherwise read as an unknown position.
const TRACE_KINDS: ReadonlySet<string> = new Set([EVENT_KIND.SHIP_STAGE, EVENT_KIND.HEARTBEAT])

const event_schema = z.object({
	pos: z.number(),
	at: z.string(),
	kind: z.string(),
	text: z.string(),
})

type RunEvent = z.infer<typeof event_schema>

interface AppendResult {
	appended: boolean
	position: number
}

interface StreamRead {
	events: ReadonlyArray<RunEvent>
	next_position: number
}

// A kind the enumeration names, and nothing else. The predicate is what `append` asks before it writes,
// so an event outside the enumeration is never appended (joshuafolkken/kit#2205).
function is_event_kind(value: string): value is EventKind {
	return EVENT_KINDS.includes(value)
}

// The stream's path, keyed on the run's identity the caller resolved. `.jsonl` so the append surface is
// named for what it is.
function target_of(repository: string): string {
	return stamp_file.stamp_path(EVENT_PREFIX, repository, EVENT_SUFFIX)
}

function is_present(event: RunEvent | undefined): event is RunEvent {
	return event !== undefined
}

// A malformed line reads as no event rather than throwing, so one truncated append — a write that lost a
// race — never makes the whole stream unreadable.
function parse_line(line: string): RunEvent | undefined {
	try {
		return event_schema.safeParse(JSON.parse(line)).data
	} catch {
		return undefined
	}
}

// Every event on the stream, oldest first. An absent or unreadable file is an empty stream, the same
// fail-quiet direction `stamp_file.read_stamp_text` takes for a planted or unowned file.
function read_events(target: string): ReadonlyArray<RunEvent> {
	const raw = stamp_file.read_stamp_text(target)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => parse_line(line))
		.filter(is_present)
}

function last_position(events: ReadonlyArray<RunEvent>): number {
	return events[events.length - POSITION_INCREMENT]?.pos ?? FIRST_POSITION
}

// The bounded stream serialized back to JSONL. The newest `EVENT_CAP` are kept and the oldest roll off;
// each survivor keeps its original `pos`, so the bound never renumbers a position a reader is holding.
function serialize(events: ReadonlyArray<RunEvent>): string {
	return `${events.map((event) => JSON.stringify(event)).join(LINE_SEPARATOR)}${LINE_SEPARATOR}`
}

/**
 * Append one event, or refuse a kind the enumeration does not name.
 *
 * The position is the previous maximum plus one — monotonic across session cuts because the stream is
 * keyed to the run's identity rather than a session. `write_text_stamp` unlinks then creates
 * exclusively, so the rewrite is symlink-safe.
 */
function append(target: string, kind: string, text: string, at: string): AppendResult {
	if (!is_event_kind(kind)) return { appended: false, position: FIRST_POSITION }

	const existing = read_events(target)
	const position = last_position(existing) + POSITION_INCREMENT
	const bounded = [...existing, { pos: position, at, kind, text }].slice(-EVENT_CAP)

	stamp_file.write_text_stamp(target, serialize(bounded))

	return { appended: true, position }
}

/**
 * Every event after `position`, in order, and the position a reader passes back next time.
 *
 * `next_position` is the stream's current maximum, so a reader who reads, acts, and later asks again
 * from it gets exactly the events appended in between — the "everything since I last read" a woken
 * reader needs.
 */
function read_from(target: string, position: number): StreamRead {
	const events = read_events(target)

	return {
		events: events.filter((event) => event.pos > position),
		next_position: last_position(events),
	}
}

// The degenerate single-event read the "last line" consumers keep working as (joshuafolkken/kit#2205):
// the newest positional event, or `undefined` for a stream with none. Trace events are skipped
// (joshuafolkken/kit#2426), so the answer stays the run's position however many stage lines follow it.
function read_last(target: string): RunEvent | undefined {
	return read_events(target).findLast((event) => !TRACE_KINDS.has(event.kind))
}

// Whether `kind` is already on the stream after the newest `reset_kind` — or anywhere, before the first
// one. The episode test for a marker whose episode ends only when something specific happens rather than
// when any other event lands (joshuafolkken/kit#2464): a stall ends at a dispatch, and the merges, parks
// and heartbeats every parallel lane appends in between must not read as a fresh stall.
function has_since(events: ReadonlyArray<RunEvent>, kind: string, reset_kind: string): boolean {
	const reset_at = events.findLastIndex((event) => event.kind === reset_kind)

	return events.slice(reset_at + POSITION_INCREMENT).some((event) => event.kind === kind)
}

// One event as the line a reader relays (joshuafolkken/kit#2207). The follow reader and the degenerate
// `run:wake --list` both present events to a person, so the "what an event reads as" lives here, beside
// the enumeration it names, rather than being spelled twice at the two call sites. `at`, `kind` and
// `text` are joined with a separator no field carries, so the three stay legible in one line.
const FIELD_SEPARATOR = ' · '

function format_event(event: RunEvent): string {
	return [event.at, event.kind, event.text].join(FIELD_SEPARATOR)
}

const run_event_stream = {
	EVENT_CAP,
	EVENT_KIND,
	EVENT_KINDS,
	EVENT_PREFIX,
	EVENT_SUFFIX,
	TRACE_KINDS,
	append,
	format_event,
	has_since,
	is_event_kind,
	read_events,
	read_from,
	read_last,
	target_of,
}

export type { AppendResult, EventKind, RunEvent, StreamRead }
export { run_event_stream }
