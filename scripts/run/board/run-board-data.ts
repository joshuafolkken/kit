import type { Fetch } from './run-board-fetch'
import type { GatherRead } from './run-board-gather'
import { run_board_github } from './run-board-github'
import type { LocalRead } from './run-board-read'
import {
	run_board_state,
	type BoardData,
	type BoardState,
	type BoardView,
	type DataPorts,
	type DataPost,
	type FetchKey,
	type Pace,
} from './run-board-state'
import { run_board_thanks } from './run-board-thanks'

// One step of the data a `run:board` redraw draws from: the reads off this machine just taken, with
// the GitHub reads, the reviewers' roster and the last board's snapshot folded over them. A live board
// steps it on its worker thread and posts it beside those reads (`run-board-gather-thread.ts`), so its
// redraw reads nothing; a single frame steps it where it draws (`run-board-tick.ts`). Both take the
// same reads.

const { FRESH_DATA, FRESH_VIEW } = run_board_state
const { gather_github } = run_board_github
const { gather_thanks } = run_board_thanks
const NO_ANSWER: ReturnType<Fetch<never>['answer']> = undefined
// A read the worker still waits on, held on the board's side only so the frame says so; it never
// lands there, since the board's side folds nothing in.
const IN_FLIGHT: Fetch<never> = { landed: Promise.resolve(), answer: () => NO_ANSWER }
const FETCH_KEYS: ReadonlyArray<FetchKey> = [
	'plan_fetch',
	'closed_fetch',
	'thanks_fetch',
	'rate_limit_fetch',
	'issue_count_fetch',
]
// The stamps that say each read was asked; cleared, the read is due at once.
const UNASKED: Readonly<Record<FetchKey, Partial<DataPost>>> = {
	plan_fetch: { attempted_ms: undefined },
	closed_fetch: { closed_attempted_ms: undefined, closed_asked: new Set() },
	thanks_fetch: { thanks_attempted_ms: undefined },
	rate_limit_fetch: { rate_limit_attempted_ms: undefined },
	issue_count_fetch: { issue_count_attempted_ms: undefined },
}

// What a step reads through, at what moment and how long it waits for the reads it launches.
interface DataStep {
	ports: DataPorts
	now_ms: number
	pace: Pace
}

// What the last board on this run kept (`run-board-snapshot.ts`); one written on another run is
// discarded.
function saved_for(
	ports: DataPorts,
	started_ms: number,
): Pick<BoardData, 'known' | 'closed' | 'issue_count'> {
	const snapshot = ports.snapshot?.load()

	if (snapshot?.run_started_ms !== started_ms) return FRESH_DATA

	const { titles, labels, closed, issue_count } = snapshot

	return { known: { titles, labels }, closed, issue_count }
}

// The data of the run on screen, over the reads just taken; a different run starts its plan state
// from what the last board on it kept, or from nothing, so no row or count of the previous run is
// drawn over the new one.
function data_for(
	data: BoardData,
	read: GatherRead,
	local: LocalRead,
	ports: DataPorts,
): BoardData {
	if (data.run_started_ms === local.started_ms) return { ...data, ...read }

	const saved = saved_for(ports, local.started_ms)

	return { ...FRESH_DATA, ...saved, ...read, run_started_ms: local.started_ms }
}

// Folds what landed and launches what is due. With no run it reads nothing from GitHub and keeps the
// plan it had for when one starts.
async function step(data: BoardData, read: GatherRead, at: DataStep): Promise<BoardData> {
	const { local } = read

	if (local === undefined) return { ...data, ...read }

	const { ports, now_ms, pace } = at
	const gathered = await gather_github(data_for(data, read, local, ports), {
		ports,
		local,
		now_ms,
		pace,
	})

	return await gather_thanks(gathered, ports, now_ms, pace)
}

// The data as the worker posts it: its own reads off this machine go beside it, and each read in
// flight is named, since a promise does not cross the thread.
function posted(data: BoardData): DataPost {
	return {
		run_started_ms: data.run_started_ms,
		plan: data.plan,
		known: data.known,
		attempted_ms: data.attempted_ms,
		fetched_ms: data.fetched_ms,
		failed_ms: data.failed_ms,
		closed: data.closed,
		closed_attempted_ms: data.closed_attempted_ms,
		closed_asked: data.closed_asked,
		closed_answered_ms: data.closed_answered_ms,
		thanks: data.thanks,
		thanks_attempted_ms: data.thanks_attempted_ms,
		rate_limit: data.rate_limit,
		rate_limit_attempted_ms: data.rate_limit_attempted_ms,
		issue_count: data.issue_count,
		issue_count_attempted_ms: data.issue_count_attempted_ms,
		in_flight: FETCH_KEYS.filter((key) => data[key] !== undefined),
	}
}

function held(in_flight: ReadonlyArray<FetchKey>, key: FetchKey): Fetch<never> | undefined {
	return in_flight.includes(key) ? IN_FLIGHT : undefined
}

// The posted data over the reads it was posted beside.
function received(post: DataPost, read: GatherRead): BoardData {
	const { in_flight, ...kept } = post

	return {
		...kept,
		...read,
		plan_fetch: held(in_flight, 'plan_fetch'),
		closed_fetch: held(in_flight, 'closed_fetch'),
		thanks_fetch: held(in_flight, 'thanks_fetch'),
		rate_limit_fetch: held(in_flight, 'rate_limit_fetch'),
		issue_count_fetch: held(in_flight, 'issue_count_fetch'),
	}
}

// The posted data a worker started again begins from: the reads the last worker had in flight died
// with it, so none is held and each is asked again at once rather than after its interval.
function relaunched(post: DataPost): DataPost {
	let data: DataPost = { ...post, in_flight: [] }

	for (const key of post.in_flight) data = { ...data, ...UNASKED[key] }

	return data
}

// What the frame keeps from the last redraw: all of it on the same run, none on a different one, so
// no spinner, typing, sound or baseline of the previous run carries over.
function view_for(state: BoardState, data: BoardData): BoardView {
	return state.run_started_ms === data.run_started_ms ? state : FRESH_VIEW
}

const run_board_data = { posted, received, relaunched, step, view_for }

export { run_board_data }
export type { DataStep }
