import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_progress_cli } from '#scripts/run/progress/run-progress-cli'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_fetch, type Fetch } from './run-board-fetch'
import { run_board_idle } from './run-board-idle'
import type { BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import type { Known } from './run-board-snapshot'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import {
	run_board_status,
	type ItemState,
	type ItemStatus,
	type OpenRead,
} from './run-board-status'

// The GitHub reads a `run:board` redraw draws over: the plan, and the run's children that left the
// open listing or are drawn stopped. Each is taken no more often than `run:progress` re-reads after a decline. **A live
// board never waits on them**: each read is launched and folded in on the redraw after it lands, so
// the clock keeps moving while GitHub answers; one plain frame waits for them. A failed plan read
// keeps the previous plan on screen and says when it failed. A run that ended keeps its plan as it
// last read.

const PLAN_RETRY_MS = run_progress_cli.DECLINE_RETRY_SECONDS * MS_PER_SECOND
// A rejected closed read answers nothing closed and not whole, so it is asked again.
const UNANSWERED: ClosedAnswer = { closed: new Map(), is_whole: false }
const { is_due } = run_board_state
const STOPPED_STATE: ItemState = 'stopped'

// What a step of the GitHub reads works against.
interface Gather {
	ports: BoardPorts
	local: LocalRead
	now_ms: number
	pace: Pace
}

// A title the board once knew stays known, so an issue that left the open listing keeps its name —
// one the last board's snapshot named among them.
function with_titles(plan: BoardPlan, state: BoardState): BoardPlan {
	const previous = state.plan?.context.titles ?? state.known.titles
	const titles = new Map([...previous, ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

// An ended run's plan is read until it lands once, then held; a read in flight is not launched again.
function is_plan_due(state: BoardState, gather: Gather): boolean {
	if (state.plan_fetch !== undefined) return false
	if (gather.local.ended_ms !== undefined && state.fetched_ms !== undefined) return false

	return is_due(state.attempted_ms, PLAN_RETRY_MS, gather.now_ms)
}

function launch_plan(state: BoardState, gather: Gather): BoardState {
	if (!is_plan_due(state, gather)) return state

	async function read(): Promise<BoardPlan | undefined> {
		return await gather.ports.read_plan(gather.local.scope)
	}

	const plan_fetch = run_board_fetch.launch(read, undefined)

	return { ...state, plan_fetch, attempted_ms: gather.now_ms }
}

// A landed read is folded in as of the moment it was asked; one still in flight leaves the state as is.
function fold_plan(state: BoardState): BoardState {
	const answer = state.plan_fetch?.answer()

	if (answer === undefined) return state

	const settled = { ...state, plan_fetch: undefined }

	if (answer.value === undefined) return { ...settled, failed_ms: state.attempted_ms }

	return {
		...settled,
		plan: with_titles(answer.value, state),
		fetched_ms: state.attempted_ms,
		failed_ms: undefined,
	}
}

function statuses_for(state: BoardState, local: LocalRead): ReadonlyMap<number, ItemStatus> {
	const stopped = run_board_idle.stopped_of(state.idle_since, state.read_ms)

	return run_board_status.statuses_of(local.events, local.lane_states, stopped)
}

// The open listing the statuses are settled against — none before a plan has landed.
function open_read_of(state: BoardState, plan: BoardPlan | undefined): OpenRead {
	return {
		open_numbers: plan?.context.open_numbers,
		read_ms: state.fetched_ms,
		closed: state.closed,
		labels: plan?.labels ?? new Map(),
	}
}

// A child still drawn stopped holds no closed read of this launch — any it holds closed before it
// relaunched — so it is asked again.
function is_closed_candidate(issue: number, status: ItemStatus, read: OpenRead): boolean {
	if (status.state === STOPPED_STATE) return true

	const open = read.open_numbers

	return open !== undefined && !open.has(issue) && !read.closed.has(issue)
}

// The children the board has not read closed yet that the open listing no longer holds, or that it
// draws stopped: a child that merged itself and left its lane is drawn stopped until GitHub says it
// merged (joshuafolkken/kit#4401), and a listing cut short proves nothing missing.
function unread_closed(state: BoardState, local: LocalRead): Array<number> {
	const read = open_read_of(state, state.plan)
	const drawn = run_board_status.settle_closed(statuses_for(state, local), read)

	return [...drawn]
		.filter(([issue, status]) => is_closed_candidate(issue, status, read))
		.map(([issue]) => issue)
}

// An ended run asks until one ask after it ended has answered whole, then holds what it has, as its
// plan is held: the board is left open between runs, so a child that never answers closed would
// otherwise be asked about every retry interval while no run is going.
function has_asked_since_end(state: BoardState, local: LocalRead): boolean {
	const { closed_answered_ms } = state
	if (closed_answered_ms === undefined || local.ended_ms === undefined) return false

	return closed_answered_ms >= local.ended_ms
}

function has_new_child(state: BoardState, unread: ReadonlyArray<number>): boolean {
	return unread.some((issue) => !state.closed_asked.has(issue))
}

function is_closed_due(state: BoardState, gather: Gather, unread: ReadonlyArray<number>): boolean {
	if (state.closed_fetch !== undefined || has_asked_since_end(state, gather.local)) return false

	return (
		has_new_child(state, unread) || is_due(state.closed_attempted_ms, PLAN_RETRY_MS, gather.now_ms)
	)
}

// A closed child is read once and its answer kept; one that has not answered closed is asked again no
// sooner than the plan is — unless a child the last ask did not hold has joined it — and an ended
// run's not again once an ask after the end has answered whole.
function launch_closed(state: BoardState, gather: Gather): BoardState {
	const unread = unread_closed(state, gather.local)

	if (unread.length === 0 || !is_closed_due(state, gather, unread)) return state

	async function read(): Promise<ClosedAnswer> {
		return await gather.ports.read_closed(unread)
	}

	const closed_fetch = run_board_fetch.launch(read, UNANSWERED)

	return {
		...state,
		closed_fetch,
		closed_attempted_ms: gather.now_ms,
		closed_asked: new Set(unread),
	}
}

// A whole answer counts as of the moment it was asked.
function fold_closed(state: BoardState): BoardState {
	const answer = state.closed_fetch?.answer()

	if (answer === undefined) return state

	const { closed, is_whole } = answer.value
	const closed_answered_ms = is_whole ? state.closed_attempted_ms : state.closed_answered_ms

	return {
		...state,
		closed: new Map([...state.closed, ...closed]),
		closed_fetch: undefined,
		closed_answered_ms,
	}
}

// At the `settled` pace, waits for a read in flight to land.
async function settle(pending: Fetch<unknown> | undefined, pace: Pace): Promise<void> {
	if (pending !== undefined && pace === 'settled') await pending.landed
}

// The titles and labels the board names its rows by: the plan's once it has landed, the snapshot's before.
function known_of(state: BoardState): Known {
	if (state.plan === undefined) return state.known

	return { titles: state.plan.context.titles, labels: state.plan.labels }
}

// Each read that landed rewrites the snapshot whole, for the board opened next on this run.
function keep_snapshot(before: BoardState, after: BoardState, gather: Gather): void {
	if (after.plan === before.plan && after.closed === before.closed) return

	const run_started_ms = gather.local.started_ms

	gather.ports.snapshot?.save({ run_started_ms, ...known_of(after), closed: after.closed })
}

// Folds what landed and launches what is due — the plan first, since the closed children are read off
// the plan's listing.
async function gather_github(state: BoardState, gather: Gather): Promise<BoardState> {
	const planned = launch_plan(fold_plan(state), gather)

	await settle(planned.plan_fetch, gather.pace)

	const closing = launch_closed(fold_closed(fold_plan(planned)), gather)

	await settle(closing.closed_fetch, gather.pace)

	const gathered = fold_closed(closing)

	keep_snapshot(state, gathered, gather)

	return gathered
}

const run_board_github = { PLAN_RETRY_MS, gather_github, known_of, open_read_of, statuses_for }

export { run_board_github }
export type { Gather }
