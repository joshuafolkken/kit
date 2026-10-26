import { process_identity } from '#scripts/josh/process-identity'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import { run_event_filed } from '#scripts/run/event/run-event-filed'
import {
	run_event_overrun,
	type Longest,
	type OverrunNote,
} from '#scripts/run/event/run-event-overrun'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// What a done row says after its time (joshuafolkken/kit#4772, joshuafolkken/kit#4818): the Issues
// filed during its child's work, its lane's net minutes and what its overrun investigation came to —
// read off the stream's `filed` events and the overrun notes (`run-event-overrun.ts`). The child's own
// filings and the investigation's are kept apart by the event's recorded mark (joshuafolkken/kit#4880).

interface Found {
	// Each filing of the child's own session as `header.link` takes it: `4768`, or `owner/repo#12` for
	// one filed elsewhere. An event with no overrun mark is the child's.
	filed: ReadonlyArray<string>
	// Each filing of the lane's overrun investigation, read off its mark (joshuafolkken/kit#4880).
	overrun_filed: ReadonlyArray<string>
	// The lane's net minutes, from the notes; `undefined` where none said them.
	minutes: number | undefined
	// The child's latest overrun note.
	overrun: OverrunNote | undefined
	// The longest stage the overrun's start note carried (joshuafolkken/kit#4995), kept past its end note.
	longest: Longest | undefined
	// The latest note is the investigation's start and its session is alive; `undefined` where its start
	// token could not be read, so neither its life nor its death is known.
	is_investigating: boolean | undefined
}

// By the child's number.
type FoundOf = ReadonlyMap<number, Found>

// Whether the process a start note names — its pid and start token — is still there, one this reader
// may not signal included, `undefined` where the note carries no start token; injected, so a test never
// probes one.
type IsLive = (pid: number, start: string | undefined) => boolean | undefined

const KIND = run_event_stream.EVENT_KIND
const NONE: Found = {
	filed: [],
	overrun_filed: [],
	minutes: undefined,
	overrun: undefined,
	longest: undefined,
	is_investigating: false,
}

// The child a filing was found during, the reference the board draws, and whether the overrun filed it.
type FiledEntry = readonly [number, string, boolean]

function filed_entry(event: RunEvent): ReadonlyArray<FiledEntry> {
	const filed = event.kind === KIND.FILED ? run_event_filed.parse(event.text) : undefined

	if (filed?.found_during === undefined) return []

	return [
		[Number(filed.found_during), filed.reference.replace(/^#/u, ''), filed.is_overrun === true],
	]
}

function with_filed(known: Found, reference: string, is_overrun: boolean): Found {
	if (is_overrun) return { ...known, overrun_filed: [...known.overrun_filed, reference] }

	return { ...known, filed: [...known.filed, reference] }
}

function overrun_note(event: RunEvent): OverrunNote | undefined {
	return event.kind === KIND.NOTE ? run_event_overrun.parse(event.text) : undefined
}

// The minutes a note carries, else the ones an earlier note did: an end note carries none.
function minutes_of(note: OverrunNote, known: number | undefined): number | undefined {
	return 'minutes' in note ? (note.minutes ?? known) : known
}

// A session that died before its end note turns no spinner, nor does a later process given its pid.
function noted(found: Found, note: OverrunNote, is_live: IsLive): Found {
	return {
		...found,
		minutes: minutes_of(note, found.minutes),
		overrun: note,
		longest: note.kind === 'started' ? note.longest : found.longest,
		is_investigating: note.kind === 'started' ? is_live(note.pid, note.start) : false,
	}
}

function add_filed(found: Map<number, Found>, events: ReadonlyArray<RunEvent>): void {
	const entries = events.flatMap((event) => filed_entry(event))

	for (const [issue, reference, is_overrun] of entries) {
		found.set(issue, with_filed(found.get(issue) ?? NONE, reference, is_overrun))
	}
}

// Each child's latest overrun note decides what its row says.
function add_overrun(
	found: Map<number, Found>,
	events: ReadonlyArray<RunEvent>,
	is_live: IsLive,
): void {
	const notes = events.flatMap((event) => overrun_note(event) ?? [])

	for (const note of notes) {
		found.set(note.issue, noted(found.get(note.issue) ?? NONE, note, is_live))
	}
}

function found_of(events: ReadonlyArray<RunEvent>, is_live: IsLive): FoundOf {
	const found = new Map<number, Found>()

	add_filed(found, events)
	add_overrun(found, events, is_live)

	return found
}

// The board's own probe, each start time answered from the read's own `ps` snapshot, so neither the
// read nor a redraw runs a `ps` of its own per note (joshuafolkken/kit#4263). The pid alone reads a
// later process given that pid as the session, so the start token decides; a note without one — a
// platform that could not read it — is known dead only once its pid is gone.
async function live_in(table: TableRead | undefined): Promise<IsLive> {
	const rows = table === undefined ? undefined : await table()
	const read = lane_process_table.start_reader(rows ?? [])

	return (pid, start) => process_identity.is_present_process(pid, start, read)
}

const run_board_found = { found_of, live_in }

export { run_board_found }
export type { Found, FoundOf, IsLive }
