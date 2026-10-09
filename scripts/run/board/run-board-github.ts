import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_cli } from '#scripts/run/progress/run-progress-cli'
import type { ClosedAnswer } from './run-board-closed'
import { run_board_fetch, type Fetch } from './run-board-fetch'
import { run_board_layout, type BoardPlan } from './run-board-layout'
import type { LocalRead } from './run-board-read'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status, type ItemStatus } from './run-board-status'

// The GitHub reads a `run:board` redraw draws over: the plan, and the run's children that left the
// open listing. Each is taken no more often than `run:progress` re-reads after a decline. **A live
// board never waits on them**: each read is launched and folded in on the redraw after it lands, so
// the clock keeps moving while GitHub answers; one plain frame waits for them. A failed plan read
// keeps the previous plan on screen and says when it failed. A run that ended keeps its plan as it
// last read.

const PLAN_RETRY_MS = run_progress_cli.DECLINE_RETRY_SECONDS * run_progress.MS_PER_SECOND
// A rejected closed read answers nothing closed and not whole, so it is asked again.
const UNANSWERED: ClosedAnswer = { closed: new Map(), is_whole: false }
const { is_due } = run_board_state

// What a step of the GitHub reads works against.
interface Gather {
	ports: BoardPorts
	local: LocalRead
	now_ms: number
	pace: Pace
}

// A title the board once knew stays known, so an issue that left the open listing keeps its name.
function with_titles(plan: BoardPlan, previous: BoardPlan | undefined): BoardPlan {
	const titles = new Map([...(previous?.context.titles ?? []), ...plan.context.titles])

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
		plan: with_titles(answer.value, state.plan),
		fetched_ms: state.attempted_ms,
		failed_ms: undefined,
	}
}

function statuses_for(plan: BoardPlan, local: LocalRead): ReadonlyMap<number, ItemStatus> {
	return run_board_status.statuses_of(local.events, local.lanes, run_board_layout.numbers_of(plan))
}

// The children the run touched that the open listing no longer holds and the board has not read yet.
// A listing cut short proves nothing missing, so it asks about none.
function unread_closed(state: BoardState, local: LocalRead): Array<number> {
	const open = state.plan?.context.open_numbers

	if (open === undefined || state.plan === undefined) return []

	const touched = [...statuses_for(state.plan, local).keys()]

	return touched.filter((issue) => !open.has(issue) && !state.closed.has(issue))
}

// An ended run asks until one ask after it ended has answered whole, then holds what it has, as its
// plan is held: the board is left open between runs, so a child that never answers closed would
// otherwise be asked about every retry interval while no run is going.
function has_asked_since_end(state: BoardState, local: LocalRead): boolean {
	const { closed_answered_ms } = state
	if (closed_answered_ms === undefined || local.ended_ms === undefined) return false

	return closed_answered_ms >= local.ended_ms
}

function is_closed_due(state: BoardState, gather: Gather): boolean {
	if (state.closed_fetch !== undefined || has_asked_since_end(state, gather.local)) return false

	return is_due(state.closed_attempted_ms, PLAN_RETRY_MS, gather.now_ms)
}

// A closed child is read once and its answer kept; one that has not answered closed is asked again no
// sooner than the plan is, and an ended run's not again once an ask after the end has answered whole.
function launch_closed(state: BoardState, gather: Gather): BoardState {
	const unread = unread_closed(state, gather.local)

	if (unread.length === 0 || !is_closed_due(state, gather)) return state

	async function read(): Promise<ClosedAnswer> {
		return await gather.ports.read_closed(unread)
	}

	const closed_fetch = run_board_fetch.launch(read, UNANSWERED)

	return { ...state, closed_fetch, closed_attempted_ms: gather.now_ms }
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

// Folds what landed and launches what is due — the plan first, since the closed children are read off
// the plan's listing.
async function gather_github(state: BoardState, gather: Gather): Promise<BoardState> {
	const planned = launch_plan(fold_plan(state), gather)

	await settle(planned.plan_fetch, gather.pace)

	const closing = launch_closed(fold_closed(fold_plan(planned)), gather)

	await settle(closing.closed_fetch, gather.pace)

	return fold_closed(closing)
}

const run_board_github = { PLAN_RETRY_MS, gather_github, statuses_for }

export { run_board_github }
export type { Gather }
