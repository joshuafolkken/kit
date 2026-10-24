import { run_event_filed } from '#scripts/run/event/run-event-filed'
import { run_event_overrun, type OverrunNote } from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// What a done row says after its time (joshuafolkken/kit#4772): the Issues filed during its child's
// work, and whether the overrun investigation of the child is still running — read off the stream's
// `filed` events and the investigation's notes (`run-event-overrun.ts`).

interface Found {
	// Each filing as `header.link` takes it: `4768`, or `owner/repo#12` for one filed elsewhere.
	filed: ReadonlyArray<string>
	// The investigation's start note is on the stream, its end note is not, and its session is alive.
	is_investigating: boolean
}

// By the child's number.
type FoundOf = ReadonlyMap<number, Found>

// Whether a pid names a process still there, one this reader may not signal included; injected, so a
// test never probes one.
type IsLive = (pid: number) => boolean

const KIND = run_event_stream.EVENT_KIND
const NONE: Found = { filed: [], is_investigating: false }

function filed_pair(event: RunEvent): ReadonlyArray<readonly [number, string]> {
	const filed = event.kind === KIND.FILED ? run_event_filed.parse(event.text) : undefined

	if (filed?.found_during === undefined) return []

	return [[Number(filed.found_during), filed.reference.replace(/^#/u, '')]]
}

function overrun_note(event: RunEvent): OverrunNote | undefined {
	return event.kind === KIND.NOTE ? run_event_overrun.parse(event.text) : undefined
}

function tracked(pids: Map<number, number>, note: OverrunNote): void {
	if (note.kind === 'started') pids.set(note.issue, note.pid)
	else pids.delete(note.issue)
}

// The pid of each investigation whose end is not on the stream yet.
function open_pids(events: ReadonlyArray<RunEvent>): ReadonlyMap<number, number> {
	const pids = new Map<number, number>()
	const notes = events.flatMap((event) => overrun_note(event) ?? [])

	for (const note of notes) tracked(pids, note)

	return pids
}

function add_filed(found: Map<number, Found>, events: ReadonlyArray<RunEvent>): void {
	const pairs = events.flatMap((event) => filed_pair(event))

	for (const [issue, reference] of pairs) {
		const known = found.get(issue) ?? NONE

		found.set(issue, { ...known, filed: [...known.filed, reference] })
	}
}

// A session that died before its end note turns no spinner.
function add_investigating(
	found: Map<number, Found>,
	events: ReadonlyArray<RunEvent>,
	is_live: IsLive,
): void {
	for (const [issue, pid] of open_pids(events)) {
		if (is_live(pid)) found.set(issue, { ...(found.get(issue) ?? NONE), is_investigating: true })
	}
}

function found_of(events: ReadonlyArray<RunEvent>, is_live: IsLive): FoundOf {
	const found = new Map<number, Found>()

	add_filed(found, events)
	add_investigating(found, events, is_live)

	return found
}

const run_board_found = { found_of }

export { run_board_found }
export type { Found, FoundOf, IsLive }
