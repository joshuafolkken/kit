import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_header, type BoardHeader } from './run-board-header'
import type { RunMark } from './run-board-header-names'
import { run_board_layout, type BoardRow } from './run-board-layout'
import { run_board_sound_cues, type CueName } from './run-board-sound-cues'
import type { ItemState } from './run-board-status'

// Which cue `run:board` sounds as one frame follows another (joshuafolkken/kit#7949): each lane row and
// the run as a whole are read down to what they would sound, and only what is new since the last frame
// sounds — the loudest of it alone (`run-board-sound-cues.ts`). A CI result, a withdrawal, a pause and a
// phase moving on are left out of the reading, so they never sound.

// What the run as a whole is in, each sounding once on the frame it starts.
type RunCondition = 'drained' | 'stopped' | 'human' | 'held' | 'offline'

interface SoundSnapshot {
	// Each row's cue, by issue number; a row that would sound nothing is left out.
	readonly rows: ReadonlyMap<number, CueName>
	readonly run: ReadonlySet<RunCondition>
}

interface RunRead {
	readonly header: BoardHeader
	readonly mark: RunMark
	readonly is_drained: boolean
}

const { DRAIN } = run_event_stream.EVENT_KIND

// A row's state as its cue: a launch, a lane's end, a wait on a person (🙋 and 💤 alike), a stopped lane.
const ROW_CUES: Readonly<Partial<Record<ItemState, CueName>>> = {
	running: 'launch',
	merged: 'lane-end',
	done: 'lane-end',
	human: 'human',
	parked: 'human',
	stopped: 'alert',
}

const RUN_CUES: Readonly<Record<RunCondition, CueName>> = {
	drained: 'drain',
	stopped: 'alert',
	// A run with nothing left but what waits on a person has stopped as surely as a stopped one.
	human: 'alert',
	held: 'alert',
	offline: 'alert',
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
function row_cue(row: BoardRow): CueName | undefined {
	if (row.status?.track?.at(-1) === 'failed') return 'alert'

	return ROW_CUES[row.state]
}

function row_entries(row: BoardRow): Array<[number, CueName]> {
	const cue = row_cue(row)

	return cue === undefined ? [] : [[row.number, cue]]
}

function conditions_of(
	header: BoardHeader,
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
	header: BoardHeader,
	events: ReadonlyArray<Pick<RunEvent, 'kind'>>,
): SoundSnapshot | undefined {
	if (header.layout === undefined) return undefined
	const rows = run_board_layout.rows_of(header.layout).flatMap((row) => row_entries(row))

	return { rows: new Map(rows), run: conditions_of(header, events) }
}

function row_cues(previous: SoundSnapshot, current: SoundSnapshot): Array<CueName> {
	const entered = [...current.rows].filter(([issue, cue]) => previous.rows.get(issue) !== cue)

	return entered.map(([, cue]) => cue)
}

function run_cues(previous: SoundSnapshot, current: SoundSnapshot): Array<CueName> {
	return [...current.run]
		.filter((condition) => !previous.run.has(condition))
		.map((condition) => RUN_CUES[condition])
}

// The one cue this frame sounds; none on the first frame, whatever it shows.
function cue_of(
	previous: SoundSnapshot | undefined,
	current: SoundSnapshot | undefined,
): CueName | undefined {
	if (previous === undefined || current === undefined) return undefined

	return run_board_sound_cues.loudest([
		...row_cues(previous, current),
		...run_cues(previous, current),
	])
}

const run_board_sound_transition = { cue_of, snapshot_of }

export { run_board_sound_transition }
export type { SoundSnapshot }
