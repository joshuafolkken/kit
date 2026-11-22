import type { EpicChild } from '#scripts/epic/epic-graph'
import { has_label_name, RUN_SOLO_LABEL, RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { run_board_decision } from './run-board-decision'
import { run_board_decision_rows } from './run-board-decision-rows'
import { run_board_earlier, type EarlierLanes } from './run-board-earlier'
import { run_board_ending_reason } from './run-board-ending-reason'
import { run_board_human } from './run-board-human'
import { run_board_human_merge } from './run-board-human-merge'
import { run_board_kind } from './run-board-kind'
import { run_board_layout_order } from './run-board-layout-order'
import type {
	BoardLayout,
	BoardPlan,
	BoardRow,
	Overlay,
	QueuedEntry,
	ReasonOf,
	RowRead,
	RowReason,
} from './run-board-layout-types'
import { run_board_parked_decision } from './run-board-parked-decision'
import { run_board_retry_wait } from './run-board-retry-wait'
import { run_board_review_stop } from './run-board-review-stop'
import { run_board_standing_waits } from './run-board-standing-waits'
import type { ItemState, ItemStatus } from './run-board-status'

// The plan with each issue's status laid over it — pure, so the order the board
// draws is tested apart from the screen. **The order is the plan's**: the queued rows run in
// `backlog_waves.build`'s order, the same play-forward `backlog:plan --waves` prints, so a merge, a park or
// a new arrival that changes the plan changes the board with it. The board draws them as one queue, not
// as waves: a running batch dispatches each row once a lane is free and its paths are, never wave by
// wave (joshuafolkken/kit#4137). The plan leaves out what a run already holds or has closed, so those
// rows come from the stream instead, in the leading active section.
//
// **An epic and its children are a tree; every other dependency is not.** A child an opted-in epic
// tracks is drawn under its epic; a `blocked_by` edge is a DAG, so it stays a waiting-on note at the end of the row.

const NO_READ: RowRead = { titles: new Map(), labels: new Map() }

// The overlay a layout is drawn from: the plan under the statuses, and what each waiting row says.
interface Drawn extends Overlay {
	reason_of: ReasonOf | undefined
}

// Whether a blocker the plan names still stands for `child` — the wait its row draws as 🔗.
function is_blocked(child: EpicChild, overlay: Overlay): boolean {
	return child.blocked_by.some((edge) => run_board_standing_waits.is_waiting_on(edge, overlay))
}

// What a person does for a row waiting on one: merge its pull request (🔏), review a review stop's
// changes, or decide.
function human_reason(child: EpicChild, plan: BoardPlan): RowReason | undefined {
	return (
		run_board_human_merge.reason_of(child, plan) ??
		run_board_review_stop.reason_of(child, plan) ??
		run_board_decision.plan_reason(child.number, plan)
	)
}

// Why a waiting row waits, or what resumes a stalled one.
function plan_reason(
	child: EpicChild,
	state: ItemState,
	overlay: Drawn,
	waits: ReadonlyArray<string>,
): RowReason | undefined {
	if (state === 'human') return human_reason(child, overlay.plan)

	if (state === 'stopped') {
		return run_board_ending_reason.stalled_reason(child.number, overlay.plan, waits)
	}

	return state === 'waiting' ? overlay.reason_of?.(child, waits) : undefined
}

function plan_row(child: EpicChild, state: ItemState, overlay: Drawn): BoardRow {
	const { context } = overlay.plan
	const waits = run_board_standing_waits.waits_of(child, overlay)
	const reason = plan_reason(child, state, overlay, waits)

	return {
		...(reason !== undefined && { reason }),
		number: child.number,
		title: context.titles.get(child.number),
		kind: run_board_kind.kind_of(child.labels),
		priority: run_board_kind.priority_of(child.labels),
		state,
		status: undefined,
		waits,
	}
}

function solo_flag(labels: ReadonlyArray<string> = []): Pick<BoardRow, 'is_solo'> {
	return has_label_name(labels, RUN_SOLO_LABEL) ? { is_solo: true } : {}
}

// A child parked on a decision, or withdrawn while its open issue still waits on a person, is a 🙋 row,
// as an untouched `needs-decision` child is; its tail names the decision that resumes it.
function touched_row(number: number, status: ItemStatus, read: RowRead): BoardRow {
	const is_asked = run_board_parked_decision.is_parked_decision(number, status, read)
	const labels = read.labels.get(number)

	return {
		...(is_asked
			? { reason: run_board_decision.reason_of(number, status.reason, read, status) }
			: run_board_ending_reason.row_reason(number, status, read)),
		...solo_flag(labels),
		number,
		title: read.titles.get(number),
		kind: run_board_kind.kind_of(labels),
		priority: run_board_kind.priority_of(labels),
		state: is_asked ? 'human' : status.state,
		status,
		waits: run_board_standing_waits.of_touched(number, status, read.waits),
	}
}

// Every child the run has touched: the running ones and then the parked ones in the order each
// started, then the finished ones from the newest end.
function active_rows(statuses: ReadonlyMap<number, ItemStatus>, read: RowRead): Array<BoardRow> {
	const rows = [...statuses].map(([number, status]) => touched_row(number, status, read))

	return rows.toSorted(run_board_layout_order.active_order)
}

// The epic row carries its own title, read from the same open listing as its children's — an opted-in
// epic is an open issue.
function place_in_epic(
	entries: Array<QueuedEntry>,
	epic: number,
	overlay: Drawn,
	row: BoardRow,
): void {
	const group = entries.find((entry) => entry.kind === 'epic' && entry.epic === epic)
	const title = overlay.plan.context.titles.get(epic)

	if (group?.kind === 'epic') group.rows.push(row)
	else entries.push({ kind: 'epic', epic, title, rows: [row] })
}

function is_untouched(child: EpicChild, overlay: Overlay): boolean {
	return !overlay.statuses.has(child.number)
}

// A plan row waits, unless it waits on a person — a decision, a merge drawn with 🔏, or a review stop
// — or the run stalled on it mechanically (`run:stalled`), which is drawn as the stop it is, never as
// a decision.
function plan_state(child: EpicChild, plan: BoardPlan): ItemState {
	if (run_board_human.is_human(child.labels) || run_board_review_stop.is_stopped(child, plan)) {
		return 'human'
	}

	return has_label_name(child.labels, RUN_STALLED_LABEL) ? 'stopped' : 'waiting'
}

// The queue, its rows in the plan's order, an epic's children gathered under the epic where the first
// of them falls.
function queued_entries(queue: ReadonlyArray<EpicChild>, overlay: Drawn): Array<QueuedEntry> {
	const entries: Array<QueuedEntry> = []

	for (const child of queue) {
		const row = plan_row(child, plan_state(child, overlay.plan), overlay)
		const epic = overlay.plan.tracked.get(child.number)

		if (epic === undefined) entries.push({ kind: 'row', row })
		else place_in_epic(entries, epic, overlay, row)
	}

	return entries
}

function unreached_rows(overlay: Drawn, is_people: boolean): Array<BoardRow> {
	return overlay.plan.waves.unreached
		.filter((child) => is_untouched(child, overlay))
		.map((child) => plan_row(child, plan_state(child, overlay.plan), overlay))
		.filter((row) => (row.state === 'human') === is_people)
		.toSorted(run_board_layout_order.start_order)
}

// Every issue the plan holds, wave or unreached.
function children_of(plan: BoardPlan): Array<EpicChild> {
	return [...plan.waves.waves.flat(), ...plan.waves.unreached]
}

// The children whose rows wait on the run rather than on a person: the run has not touched them, and
// it is neither parked for a decision nor stalled.
function waiting_children(overlay: Overlay): Array<EpicChild> {
	return children_of(overlay.plan).filter(
		(child) => is_untouched(child, overlay) && plan_state(child, overlay.plan) === 'waiting',
	)
}

// The run's scope a lane is checked against — its running issues too, which no wave holds.
function numbers_of(plan: BoardPlan): ReadonlySet<number> {
	const running = plan.waves.running ?? []

	return new Set([...children_of(plan), ...running].map((child) => child.number))
}

// The blockers a person acts on that no row of the board draws — the run's own rows and an earlier
// run's lane working the blocker (`run-board-decision-rows.ts`).
function blocker_rows(overlay: Overlay, earlier: ReadonlyArray<BoardRow>): Array<BoardRow> {
	const { plan, statuses } = overlay
	const drawn = new Set([
		...numbers_of(plan),
		...statuses.keys(),
		...earlier.map((row) => row.number),
	])

	return run_board_decision_rows.rows_of(plan, drawn)
}

// The plan row's reading of a planned child by number, for a touched ⏳ row with no blocker.
function held_of(children: ReadonlyArray<EpicChild>, reason_of: ReasonOf): RowRead['held_of'] {
	const by_number = new Map(children.map((child) => [child.number, child]))

	return function held(number) {
		const child = by_number.get(number)

		return child === undefined ? undefined : reason_of(child, [])
	}
}

function row_read(overlay: Drawn): RowRead {
	const { plan, reason_of } = overlay
	const children = children_of(plan)
	const waits = run_board_standing_waits.by_number(children, overlay)
	const held = reason_of === undefined ? undefined : held_of(children, reason_of)

	return { ...plan, titles: plan.context.titles, waits, held_of: held }
}

// What the layout reads beyond the plan and the statuses: each row's reason, and the earlier run's lanes.
interface LayoutReads {
	reason_of?: ReasonOf | undefined
	earlier?: EarlierLanes | undefined
}

function layout_of(
	input_plan: BoardPlan,
	input_statuses: ReadonlyMap<number, ItemStatus>,
	{ reason_of, earlier = run_board_earlier.NO_EARLIER }: LayoutReads = {},
): BoardLayout {
	const current = run_board_retry_wait.overlay_of(input_plan, input_statuses)
	const { plan, statuses } = current
	const overlay = { plan, statuses, reason_of }
	const queue = plan.waves.waves.flat().filter((child) => is_untouched(child, overlay))
	const read = row_read(overlay)
	const earlier_rows = run_board_earlier
		.rows_of(earlier, statuses, read)
		.filter((row) => !current.waiting_numbers.has(row.number))

	return {
		active: run_board_decision_rows.held(active_rows(statuses, read), plan),
		queued: queued_entries(queue, overlay),
		people: run_board_decision_rows.held(unreached_rows(overlay, true), plan),
		unreached: unreached_rows(overlay, false),
		blockers: blocker_rows(overlay, earlier_rows),
		earlier: earlier_rows,
	}
}

const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }

// The earlier run's lanes and what each row reads; none and nothing when omitted.
interface LocalLayoutOptions {
	earlier?: EarlierLanes
	read?: RowRead
}

// The run's own children before the plan is read: the stream and the lanes are local and read at
// once, so the rows, their states and how long each has run are drawn while GitHub answers; the titles
// and every issue the run has not touched wait for the plan.
function local_layout_of(
	statuses: ReadonlyMap<number, ItemStatus>,
	{ earlier = run_board_earlier.NO_EARLIER, read = NO_READ }: LocalLayoutOptions = {},
): BoardLayout {
	return {
		...EMPTY_LAYOUT,
		active: active_rows(statuses, read),
		earlier: run_board_earlier.rows_of(earlier, statuses, read),
	}
}

// The queued rows, an epic's children among them.
function queued_rows(layout: BoardLayout): Array<BoardRow> {
	return layout.queued.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))
}

// Every row the layout draws, an epic's children among them — what the header counts and the legend reads.
function rows_of(layout: BoardLayout): Array<BoardRow> {
	return [...layout.active, ...queued_rows(layout), ...layout.people, ...layout.unreached]
}

// Every row the frame draws — the root checkout's single run's, the counted ones and the earlier run's
// lanes — what the legend reads.
function drawn_rows(layout: BoardLayout): Array<BoardRow> {
	return [
		layout.root?.row ?? [],
		rows_of(layout),
		layout.blockers ?? [],
		layout.earlier ?? [],
	].flat()
}

// Every row waiting on a person: the touched children parked on a decision, the untouched children a
// stop names, then the blockers outside the run a person acts on — what the 🙋 section draws and the
// header and the now line count as a person's.
function people_of(layout: BoardLayout): Array<BoardRow> {
	const asked = layout.active.filter((row) => row.state === 'human')

	return [...asked, ...layout.people, ...(layout.blockers ?? [])]
}

// The root checkout's single run's row, the run's own rows `apart` does not name, then the earlier
// run's lanes still holding a place.
function lane_rows(layout: BoardLayout, apart: ReadonlyArray<BoardRow>): Array<BoardRow> {
	const own = layout.active.filter((row) => !apart.includes(row))

	return [layout.root?.row ?? [], own, layout.earlier ?? []].flat()
}

// The lanes section's rows: those neither finished nor waiting on a person's decision.
function lanes_drawn(layout: BoardLayout): Array<BoardRow> {
	const finished = layout.active.filter((row) => run_board_layout_order.is_finished(row.state))

	return lane_rows(layout, [...finished, ...people_of(layout)])
}

// The parked children the findings section says the park of: still parked on the board, their rows
// drawing no park reason of their own. A child a person released or closed is no row of this
// (joshuafolkken/kit#4127), and a reason its row draws is not said twice.
function listed_parks(layout: BoardLayout): ReadonlySet<number> {
	const parks = layout.active.filter((row) => row.state === 'parked' && row.reason === undefined)

	return new Set(parks.map((row) => row.number))
}

const run_board_layout = {
	EMPTY_LAYOUT,
	active_order: run_board_layout_order.active_order,
	drawn_rows,
	is_blocked,
	is_decision: run_board_human.is_decision,
	is_finished: run_board_layout_order.is_finished,
	is_settled: run_board_layout_order.is_settled,
	lane_rows,
	lanes_drawn,
	layout_of,
	listed_parks,
	local_layout_of,
	people_of,
	numbers_of,
	queued_rows,
	rows_of,
	waiting_children,
}

export { run_board_layout }

export {
	type BoardLayout,
	type BoardPlan,
	type BoardRow,
	type DecisionBlocker,
	type Overlay,
	type QueuedEntry,
	type ReasonOf,
	type RowRead,
	type RowReason,
} from './run-board-layout-types'
