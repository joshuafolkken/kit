import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_progress } from '#scripts/run/progress/run-progress'
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

const PLAN_RETRY_MS = run_progress.DECLINE_RETRY_SECONDS * MS_PER_SECOND
// A rejected closed read answers nothing closed and not whole, so it is asked again.
const UNANSWERED: ClosedAnswer = { closed: new Map(), is_whole: false }
const { is_due } = run_board_state
const STOPPED_STATE: ItemState = 'stopped'
const RUNNING_STATE: ItemState = 'running'
// A child waiting on a person, drawn in 🙋 decision until a closed read settles it.
const { WAITING_STATES } = run_board_status
const ALWAYS_ASKED_STATES: ReadonlySet<ItemState> = new Set([STOPPED_STATE, ...WAITING_STATES])

// What a step of the GitHub reads works against.
interface Gather {
	ports: BoardPorts
	local: LocalRead
	now_ms: number
	pace: Pace
}

// A title the board once knew stays known, so an issue that left the open listing keeps its name —
// one the last board's snapshot named among them.
function titles_of(state: BoardState): ReadonlyMap<number, string> {
	return state.plan?.context.titles ?? state.known.titles
}

function with_titles(plan: BoardPlan, state: BoardState): BoardPlan {
	const titles = new Map([...titles_of(state), ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

// A lane this run started after the last plan read was asked, on an issue the plan has no title for
// (joshuafolkken/kit#4577). The read it launches is asked after the lane started, so a title still
// missing after it — past the listing's cap, or a failed read — waits the usual interval.
function has_untitled_lane(state: BoardState, gather: Gather): boolean {
	const asked_ms = state.attempted_ms ?? Infinity
	const titles = titles_of(state)

	return [...gather.local.lane_states.own].some(
		([issue, status]) => !titles.has(issue) && (status.started_ms ?? -Infinity) > asked_ms,
	)
}

// An ended run's plan is read until it lands once, then held; a read in flight is not launched again.
// A lane with no title is read for at once rather than after the interval.
function is_plan_due(state: BoardState, gather: Gather): boolean {
	if (state.plan_fetch !== undefined) return false
	if (gather.local.ended_ms !== undefined && state.fetched_ms !== undefined) return false

	return (
		is_due(state.attempted_ms, PLAN_RETRY_MS, gather.now_ms) || has_untitled_lane(state, gather)
	)
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
	const stopped = run_board_idle.stopped_since(state.idle_since, state.read_ms)

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

function is_unlisted(issue: number, read: OpenRead): boolean {
	const open = read.open_numbers

	return open !== undefined && !open.has(issue)
}

// A child still drawn stopped or running holds no closed read of this launch — any it holds closed
// before it relaunched — so it is asked again. A running child is asked too while the plan read fails:
// the kept plan still lists it, and an empty listing — failed, or a repository whose last open issue
// was this child — would otherwise leave it running forever (joshuafolkken/kit#4537). A child waiting
// on a person is asked whatever the listing says: the listing is held once the run ends, so a close
// it never saw kept the child in 🙋 decision (joshuafolkken/kit#6535).
function is_closed_candidate(
	issue: number,
	status: ItemStatus,
	read: OpenRead,
	is_plan_failed: boolean,
): boolean {
	if (ALWAYS_ASKED_STATES.has(status.state)) return true
	if (status.state === RUNNING_STATE) return is_plan_failed || is_unlisted(issue, read)

	return is_unlisted(issue, read) && !read.closed.has(issue)
}

// An ended run asks until one ask after it ended has answered whole, then holds what it has, as its
// plan is held: the board is left open between runs, so a child that never answers closed would
// otherwise be asked about every retry interval while no run is going. A child waiting on a person
// is the exception — the person closing it is what the board waits to draw.
function has_asked_since_end(state: BoardState, local: LocalRead): boolean {
	const { closed_answered_ms } = state
	if (closed_answered_ms === undefined || local.ended_ms === undefined) return false

	return closed_answered_ms >= local.ended_ms
}

// The children the board has not read closed yet that the open listing no longer holds, or that it
// draws stopped or waiting: a child that merged itself and left its lane is drawn stopped until GitHub
// says it merged (joshuafolkken/kit#4401), and a listing cut short proves nothing missing.
function unread_closed(state: BoardState, local: LocalRead): Array<number> {
	const read = open_read_of(state, state.plan)
	const drawn = run_board_status.settle_closed(statuses_for(state, local), read)
	const is_plan_failed = state.failed_ms !== undefined
	const is_ended = has_asked_since_end(state, local)

	return [...drawn]
		.filter(([issue, status]) =>
			is_ended
				? WAITING_STATES.has(status.state)
				: is_closed_candidate(issue, status, read, is_plan_failed),
		)
		.map(([issue]) => issue)
}

function has_new_child(state: BoardState, unread: ReadonlyArray<number>): boolean {
	return unread.some((issue) => !state.closed_asked.has(issue))
}

function is_closed_due(state: BoardState, gather: Gather, unread: ReadonlyArray<number>): boolean {
	if (state.closed_fetch !== undefined) return false

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

// The core rate limit is asked as often as the plan; a read in flight is not launched again.
function launch_rate_limit(state: BoardState, gather: Gather): BoardState {
	const { read_rate_limit } = gather.ports

	if (
		read_rate_limit === undefined ||
		state.rate_limit_fetch !== undefined ||
		!is_due(state.rate_limit_attempted_ms, PLAN_RETRY_MS, gather.now_ms)
	) {
		return state
	}

	const rate_limit_fetch = run_board_fetch.launch(read_rate_limit, undefined)

	return { ...state, rate_limit_fetch, rate_limit_attempted_ms: gather.now_ms }
}

// A failed read answers `undefined`, which clears the last allowance rather than drawing a stale one.
function fold_rate_limit(state: BoardState): BoardState {
	const answer = state.rate_limit_fetch?.answer()

	if (answer === undefined) return state

	return { ...state, rate_limit: answer.value, rate_limit_fetch: undefined }
}

// The repository's issue count is asked as often as the plan, once the plan has named the repository;
// a read in flight is not launched again, and an ended run holds the count it has, as it holds its plan.
function is_issue_count_due(state: BoardState, gather: Gather): boolean {
	if (state.issue_count_fetch !== undefined) return false
	if (gather.local.ended_ms !== undefined && state.issue_count !== undefined) return false

	return is_due(state.issue_count_attempted_ms, PLAN_RETRY_MS, gather.now_ms)
}

function repo_of(state: BoardState): string | undefined {
	return state.plan?.context.repo
}

function launch_issue_count(state: BoardState, gather: Gather): BoardState {
	const { read_issue_count } = gather.ports
	const repo = repo_of(state)

	if (repo === undefined || read_issue_count === undefined || !is_issue_count_due(state, gather)) {
		return state
	}

	const issue_count_fetch = run_board_fetch.launch(
		read_issue_count.bind(undefined, repo),
		undefined,
	)

	return { ...state, issue_count_fetch, issue_count_attempted_ms: gather.now_ms }
}

// A failed read answers `undefined`, which clears the last count rather than drawing a stale one.
function fold_issue_count(state: BoardState): BoardState {
	const answer = state.issue_count_fetch?.answer()

	if (answer === undefined) return state

	return { ...state, issue_count: answer.value, issue_count_fetch: undefined }
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
	const is_same = after.plan === before.plan && after.closed === before.closed

	if (is_same && after.issue_count === before.issue_count) return

	const { closed, issue_count } = after
	const run_started_ms = gather.local.started_ms

	gather.ports.snapshot?.save({ run_started_ms, ...known_of(after), closed, issue_count })
}

// The reads the plan has to land first: the closed children are read off its listing, and the issue
// count asks for the repository it names.
async function gather_after_plan(planned: BoardState, gather: Gather): Promise<BoardState> {
	const opened = fold_issue_count(fold_closed(fold_plan(planned)))
	const closing = launch_issue_count(launch_closed(opened, gather), gather)

	await settle(closing.closed_fetch, gather.pace)
	await settle(closing.issue_count_fetch, gather.pace)

	return fold_issue_count(fold_rate_limit(fold_closed(closing)))
}

// Folds what landed and launches what is due — the plan first, since the reads after it need it; the
// rate limit beside the plan, since nothing waits on it.
async function gather_github(state: BoardState, gather: Gather): Promise<BoardState> {
	const folded = fold_plan(fold_rate_limit(state))
	const planned = launch_rate_limit(launch_plan(folded, gather), gather)

	await settle(planned.plan_fetch, gather.pace)
	await settle(planned.rate_limit_fetch, gather.pace)

	const gathered = await gather_after_plan(planned, gather)

	keep_snapshot(state, gathered, gather)

	return gathered
}

const run_board_github = { PLAN_RETRY_MS, gather_github, known_of, open_read_of, statuses_for }

export { run_board_github }
export type { Gather }
