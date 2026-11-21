import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_header, type BoardHeader, type MarkHeader } from './run-board-header'
import type { RunMark } from './run-board-header-names'
import { run_board_layout, type BoardRow } from './run-board-layout'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import type { ItemState } from './run-board-status'

// Which cue `run:board` sounds as one frame follows another (joshuafolkken/kit#7949): each lane row and
// the run as a whole are read down to what they would sound, and only what is new since the last frame
// sounds — the loudest of it alone (`run-board-sound-cues.ts`). A CI result, a withdrawal, a pause and a
// phase moving on are left out of the reading, so they never sound. Each cue carries its cause — the
// row's issue and what it entered, or the run's condition — so the header can say what sounded
// (joshuafolkken/kit#8107).

// What the run as a whole is in, each sounding once on the frame it starts.
type RunCondition = 'drained' | 'stopped' | 'human' | 'held' | 'offline'

// A cue and the words for what sounded it, in the board's own vocabulary.
interface Sound {
	readonly cue: CueName
	readonly word: string
}

// A cue with its cause: the row's issue, or none where the run as a whole sounded it.
interface Cause extends Sound {
	readonly issue?: number | undefined
}

interface SoundSnapshot {
	// Each row's cause, by issue number; a row that would sound nothing is left out.
	readonly rows: ReadonlyMap<number, Cause>
	readonly run: ReadonlySet<RunCondition>
}

// What a frame's sound is read off: no port, so it is decided before the frame is drawn.
type SoundHeader = MarkHeader & Pick<BoardHeader, 'quota_hold'>

interface RunRead {
	readonly header: SoundHeader
	readonly mark: RunMark
	readonly is_drained: boolean
}

const { DRAIN } = run_event_stream.EVENT_KIND

const PERSON_WAIT: Sound = { cue: 'human', word: 'needs a person' }
const FAILED_SHIP: Sound = { cue: 'alert', word: 'failed' }

// A row's state as its cue: a launch, a lane's end, a wait on a person (🙋 and 💤 alike), a stopped lane.
const ROW_SOUNDS: Readonly<Partial<Record<ItemState, Sound>>> = {
	running: { cue: 'launch', word: 'running' },
	merged: { cue: 'lane-end', word: 'merged' },
	done: { cue: 'lane-end', word: 'done' },
	human: PERSON_WAIT,
	parked: PERSON_WAIT,
	stopped: { cue: 'alert', word: 'stopped' },
}

const RUN_SOUNDS: Readonly<Record<RunCondition, Sound>> = {
	drained: { cue: 'drain', word: 'run drained' },
	stopped: { cue: 'alert', word: 'run stopped' },
	// A run with nothing left but what waits on a person has stopped as surely as a stopped one.
	human: { cue: 'alert', word: 'run needs a person' },
	held: { cue: 'alert', word: 'usage held' },
	offline: { cue: 'alert', word: 'offline' },
}

// A drained run is no stopped one: it ran out of work, so its stop never sounds as a fault. A usage
// limit and an outage are apart, so one opening while the other holds still sounds.
const RUN_CHECKS: ReadonlyArray<readonly [RunCondition, (read: RunRead) => boolean]> = [
	['drained', (read) => read.is_drained],
	['stopped', (read) => !read.is_drained && read.mark === 'stopped'],
	['human', (read) => read.mark === 'human'],
	['held', (read) => read.header.quota_hold !== undefined],
	['offline', (read) => read.header.activity.outage !== undefined],
]

// A ship that failed is a fault whatever state its row is drawn in.
function row_sound(row: BoardRow): Sound | undefined {
	if (row.status?.track?.at(-1) === 'failed') return FAILED_SHIP

	return ROW_SOUNDS[row.state]
}

function row_entries(row: BoardRow): Array<[number, Cause]> {
	const sound = row_sound(row)

	return sound === undefined ? [] : [[row.number, { ...sound, issue: row.number }]]
}

function conditions_of(
	header: SoundHeader,
	events: ReadonlyArray<Pick<RunEvent, 'kind'>>,
): Set<RunCondition> {
	const read = {
		header,
		mark: run_board_header.run_mark_of(header),
		is_drained: events.some((event) => event.kind === DRAIN),
	}

	return new Set(RUN_CHECKS.filter(([, check]) => check(read)).map(([condition]) => condition))
}

// What a frame would sound, `undefined` before the plan's layout is read — a frame with no rows yet is no
// base to hear every running lane as launched against.
function snapshot_of(
	header: SoundHeader,
	events: ReadonlyArray<Pick<RunEvent, 'kind'>>,
): SoundSnapshot | undefined {
	if (header.layout === undefined) return undefined
	const rows = run_board_layout.rows_of(header.layout).flatMap((row) => row_entries(row))

	return { rows: new Map(rows), run: conditions_of(header, events) }
}

// A row sounds when its cue changes; a move between two states of one cue stays silent.
function row_causes(previous: SoundSnapshot, current: SoundSnapshot): Array<Cause> {
	return [...current.rows]
		.filter(([issue, cause]) => previous.rows.get(issue)?.cue !== cause.cue)
		.map(([, cause]) => cause)
}

function run_causes(previous: SoundSnapshot, current: SoundSnapshot): Array<Cause> {
	return [...current.run]
		.filter((condition) => !previous.run.has(condition))
		.map((condition) => RUN_SOUNDS[condition])
}

// The cause of the loudest cue among `causes` (`run-board-sound-cues.ts`), the first named winning a tie.
function loudest_cause(causes: ReadonlyArray<Cause>): Cause | undefined {
	const loudest = run_board_sound_cues.loudest(causes.map((cause) => cause.cue))

	return causes.find((cause) => cause.cue === loudest)
}

// The one cause this frame sounds; none on the first frame, whatever it shows.
function cause_of(
	previous: SoundSnapshot | undefined,
	current: SoundSnapshot | undefined,
): Cause | undefined {
	if (previous === undefined || current === undefined) return undefined

	return loudest_cause([...row_causes(previous, current), ...run_causes(previous, current)])
}

// Every cause a frame holds, its rows' and the run's alike — what stays true across frames, not what is new.
function held_causes(snapshot: SoundSnapshot): Array<Cause> {
	return [...snapshot.rows.values(), ...[...snapshot.run].map((condition) => RUN_SOUNDS[condition])]
}

const run_board_sound_transition = { cause_of, held_causes, loudest_cause, snapshot_of }

export { run_board_sound_transition }
export type { Cause, SoundHeader, SoundSnapshot }
