import type { Declared } from '#scripts/backlog/backlog-overlap'
import { backlog_plan, type PlanContext } from '#scripts/backlog/backlog-plan'
import type { WavePlan } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { issue_cite } from '#scripts/issue/issue-cite'
import {
	has_label_name,
	NEEDS_DECISION_LABEL,
	RUN_SOLO_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { run_stalled } from '#scripts/run/park/run-stalled'
import { run_board_earlier, type EarlierLanes } from './run-board-earlier'
import { run_board_kind, type BoardPriority } from './run-board-kind'
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

interface BoardPlan {
	waves: WavePlan
	// Which opted-in epic tracks which child (`Plan.tracked`).
	tracked: ReadonlyMap<number, number>
	context: PlanContext
	// Each issue's label names as the open listing read them, so a running row is drawn as its labels
	// say it stopped.
	labels: ReadonlyMap<number, ReadonlyArray<string>>
	// The paths each issue's body declares (`Plan.scope.declared`), which a waiting row is checked
	// against a running one by; a plan read without them checks none.
	declared?: Declared | undefined
	// The issues the classifier withholds for a person (`EpicNextResult.blocked_on_people`) — a blocker
	// this run will not finish among them — whose waiting row leads with 🙋.
	withheld?: ReadonlySet<number> | undefined
}

// Why a waiting row waits, or the stage its lane's launch is at, as one value its row only draws
// (joshuafolkken/kit#4288): the icon it leads with in place of ⏳, the condition column's value, and
// what follows its title. A parked, withdrawn or stalled row draws its tail alone.
interface RowReason {
	icon?: string | undefined
	// The condition column's figure — a lane count, a memory reading, a start time.
	value?: string | undefined
	// The issues the wait names, in place of a figure: the first in the condition column, with
	// `+<rest>` where the rest follow its title.
	issues?: ReadonlyArray<string> | undefined
	tail?: string | undefined
	// When the row entered a stage, where the reason is one — the condition column counts how long it
	// has stood there from it.
	since_ms?: number | undefined
	// The start time its body declares and the row waits on, which orders the 📅 rows.
	not_before_ms?: number | undefined
}

// What a waiting child's row says, given the blockers still standing for it; `undefined` says nothing.
type ReasonOf = (child: EpicChild, waits: ReadonlyArray<string>) => RowReason | undefined

interface BoardRow {
	number: number
	title: string | undefined
	// The release category its labels place it in (joshuafolkken/kit#3577), none for an Other Change.
	kind: FiledKind | undefined
	// The priority label it carries (joshuafolkken/kit#4383), none for a normal one.
	priority?: BoardPriority | undefined
	state: ItemState
	status: ItemStatus | undefined
	// The standing blockers this row still waits on, as the plan names them.
	waits: ReadonlyArray<string>
	// Why the row waits beyond its blockers (`run-board-reason.ts`), or why a parked or withdrawn row
	// ended; any other row the run has touched has none.
	reason?: RowReason | undefined
	// An earlier run's lane (`run-board-earlier.ts`): drawn as its status says, marked 🧳.
	is_earlier?: boolean | undefined
	// A touched child carrying `run:solo`, which nothing else starts beside while it runs.
	is_solo?: boolean | undefined
}

type QueuedEntry =
	| { kind: 'row'; row: BoardRow }
	| { kind: 'epic'; epic: number; title: string | undefined; rows: Array<BoardRow> }

interface BoardLayout {
	active: ReadonlyArray<BoardRow>
	queued: ReadonlyArray<QueuedEntry>
	people: ReadonlyArray<BoardRow>
	unreached: ReadonlyArray<BoardRow>
	// The earlier run's lanes that still hold a place under the limit, and the lanes with no record —
	// drawn after the run's own lanes, and no row the header counts.
	earlier?: ReadonlyArray<BoardRow> | undefined
}

// What an active row is named and classified by — each issue's title and labels.
interface RowRead {
	titles: ReadonlyMap<number, string>
	labels: ReadonlyMap<number, ReadonlyArray<string>>
}

const NO_READ: RowRead = { titles: new Map(), labels: new Map() }

interface Overlay {
	plan: BoardPlan
	statuses: ReadonlyMap<number, ItemStatus>
}

// The overlay a layout is drawn from: the plan under the statuses, and what each waiting row says.
interface Drawn extends Overlay {
	reason_of: ReasonOf | undefined
}

const SETTLED_STATES: ReadonlySet<ItemState> = new Set(['merged', 'parked', 'done', 'withdrawn'])

function is_settled(state: ItemState): boolean {
	return SETTLED_STATES.has(state)
}

// A blocker the plan still names, unless the stream has already seen it merge — the plan was read up
// to two minutes ago, and a merge since then is no longer worth waiting on.
function is_waiting_on(edge: IssueReference, overlay: Overlay): boolean {
	const { context } = overlay.plan
	const is_merged =
		edge.repo === context.repo && overlay.statuses.get(edge.number)?.state === 'merged'

	return !is_merged && backlog_plan.is_standing(edge, context)
}

function reference_of(edge: IssueReference, repo: string): string {
	return edge.repo === repo ? String(edge.number) : issue_cite.plain(edge.number, edge.repo)
}

// Whether a blocker the plan names still stands for `child` — the wait its row draws as 🔗.
function is_blocked(child: EpicChild, overlay: Overlay): boolean {
	return child.blocked_by.some((edge) => is_waiting_on(edge, overlay))
}

// A stalled row's right end names the action that resumes it (`run-stalled.ts`), with no event to
// name its cause.
function stalled_reason(number: number): RowReason {
	return { tail: run_stalled.row_text(number) }
}

// Why a waiting row waits, or what resumes a stalled one.
function plan_reason(
	child: EpicChild,
	state: ItemState,
	overlay: Drawn,
	waits: ReadonlyArray<string>,
): RowReason | undefined {
	if (state === 'stopped') return stalled_reason(child.number)

	return state === 'waiting' ? overlay.reason_of?.(child, waits) : undefined
}

function plan_row(child: EpicChild, state: ItemState, overlay: Drawn): BoardRow {
	const { context } = overlay.plan
	const waits = child.blocked_by
		.filter((edge) => is_waiting_on(edge, overlay))
		.map((edge) => reference_of(edge, context.repo))
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

// A child that has ended for good — drawn in the done section rather than the leading one.
const FINISHED_STATES: ReadonlySet<ItemState> = new Set(['merged', 'done', 'withdrawn'])

function is_finished(state: ItemState): boolean {
	return FINISHED_STATES.has(state)
}

// Running rows first, then the parked and stopped ones, then the finished ones. A row parked on a
// decision ranks among the parked, though the render draws it in its own 🙋 section.
function rank_of(row: BoardRow): number {
	if (row.state === 'running') return 0

	return is_finished(row.state) ? Infinity : 1
}

// A finished row sorts by its end, the newest first and one with none last; any other by its start.
function key_of(row: BoardRow): number {
	const { started_ms = Infinity, ended_ms = -Infinity } = row.status ?? {}

	return is_finished(row.state) ? -ended_ms : started_ms
}

function compared(left: number, right: number): number {
	if (left === right) return 0

	return left < right ? -1 : 1
}

function active_order(left: BoardRow, right: BoardRow): number {
	return compared(rank_of(left), rank_of(right)) || compared(key_of(left), key_of(right))
}

// The states a row its labels say stalled can be drawn in: 🛑, and 💤 where its last park event was
// bare — `run:merge`'s park of a child already labelled (`on_parked`) after the ship-stop cap's.
const STALLED_STATES: ReadonlySet<ItemState> = new Set(['stopped', 'parked'])

// A row its labels say stalled, which no ending event explains.
function is_stalled(status: ItemStatus, labels: ReadonlyArray<string> = []): boolean {
	return STALLED_STATES.has(status.state) && has_label_name(labels, RUN_STALLED_LABEL)
}

// The reason a parked or withdrawn row draws where ⏳ draws why it waits — its ending event's own —
// and a stalled row the action that resumes it.
function ending_reason(
	number: number,
	status: ItemStatus,
	labels: ReadonlyArray<string> | undefined,
): Pick<BoardRow, 'reason'> {
	if (status.reason !== undefined) return { reason: { tail: status.reason } }

	return is_stalled(status, labels) ? { reason: stalled_reason(number) } : {}
}

// A park waiting on a person's decision (joshuafolkken/kit#4099) — the one answer the 🙋 decision
// section and the findings section read a park reason by.
function is_decision(reason: string | undefined): boolean {
	return reason?.includes(NEEDS_DECISION_LABEL) === true
}

function solo_flag(labels: ReadonlyArray<string> = []): Pick<BoardRow, 'is_solo'> {
	return has_label_name(labels, RUN_SOLO_LABEL) ? { is_solo: true } : {}
}

// A child parked on a decision is a 🙋 row: it waits on a person, as an untouched `needs-decision`
// child does, and the section it is drawn in already says why, so its row draws no reason.
function touched_row(number: number, status: ItemStatus, read: RowRead): BoardRow {
	const is_asked = status.state === 'parked' && is_decision(status.reason)
	const labels = read.labels.get(number)

	return {
		...(!is_asked && ending_reason(number, status, labels)),
		...solo_flag(labels),
		number,
		title: read.titles.get(number),
		kind: run_board_kind.kind_of(labels),
		priority: run_board_kind.priority_of(labels),
		state: is_asked ? 'human' : status.state,
		status,
		waits: [],
	}
}

// Every child the run has touched: the running ones and then the parked ones in the order each
// started, then the finished ones from the newest end.
function active_rows(statuses: ReadonlyMap<number, ItemStatus>, read: RowRead): Array<BoardRow> {
	const rows = [...statuses].map(([number, status]) => touched_row(number, status, read))

	return rows.toSorted(active_order)
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

// A plan row waits, unless it waits on a person's decision — the one wait the board marks — or the run
// stalled on it mechanically (`run:stalled`), which is drawn as the stop it is, never as a decision.
function plan_state(child: EpicChild): ItemState {
	if (has_label_name(child.labels, NEEDS_DECISION_LABEL)) return 'human'

	return has_label_name(child.labels, RUN_STALLED_LABEL) ? 'stopped' : 'waiting'
}

// The queue, its rows in the plan's order, an epic's children gathered under the epic where the first
// of them falls.
function queued_entries(queue: ReadonlyArray<EpicChild>, overlay: Drawn): Array<QueuedEntry> {
	const entries: Array<QueuedEntry> = []

	for (const child of queue) {
		const row = plan_row(child, plan_state(child), overlay)
		const epic = overlay.plan.tracked.get(child.number)

		if (epic === undefined) entries.push({ kind: 'row', row })
		else place_in_epic(entries, epic, overlay, row)
	}

	return entries
}

// A row waiting on no start time keeps its plan place ahead of every 📅 row, which follow from the
// earliest start (joshuafolkken/kit#4104).
function start_order(left: BoardRow, right: BoardRow): number {
	const { not_before_ms: left_ms = -Infinity } = left.reason ?? {}
	const { not_before_ms: right_ms = -Infinity } = right.reason ?? {}

	return compared(left_ms, right_ms)
}

function unreached_rows(overlay: Drawn, is_people: boolean): Array<BoardRow> {
	return overlay.plan.waves.unreached
		.filter((child) => is_untouched(child, overlay))
		.map((child) => plan_row(child, plan_state(child), overlay))
		.filter((row) => (row.state === 'human') === is_people)
		.toSorted(start_order)
}

// Every issue the plan holds, wave or unreached.
function children_of(plan: BoardPlan): Array<EpicChild> {
	return [...plan.waves.waves.flat(), ...plan.waves.unreached]
}

// The children whose rows wait on the run rather than on a person: the run has not touched them, and
// it is neither parked for a decision nor stalled.
function waiting_children(overlay: Overlay): Array<EpicChild> {
	return children_of(overlay.plan).filter(
		(child) => is_untouched(child, overlay) && plan_state(child) === 'waiting',
	)
}

function layout_of(
	plan: BoardPlan,
	statuses: ReadonlyMap<number, ItemStatus>,
	reason_of?: ReasonOf,
	earlier: EarlierLanes = run_board_earlier.NO_EARLIER,
): BoardLayout {
	const overlay = { plan, statuses, reason_of }
	const queue = plan.waves.waves.flat().filter((child) => is_untouched(child, overlay))
	const read = { titles: plan.context.titles, labels: plan.labels }

	return {
		active: active_rows(statuses, read),
		queued: queued_entries(queue, overlay),
		people: unreached_rows(overlay, true),
		unreached: unreached_rows(overlay, false),
		earlier: run_board_earlier.rows_of(earlier, statuses, read),
	}
}

const EMPTY_LAYOUT: BoardLayout = { active: [], queued: [], people: [], unreached: [] }

// The run's own children before the plan is read: the stream and the lanes are local and read at
// once, so the rows, their states and how long each has run are drawn while GitHub answers; the titles
// and every issue the run has not touched wait for the plan.
function local_layout_of(
	statuses: ReadonlyMap<number, ItemStatus>,
	earlier: EarlierLanes = run_board_earlier.NO_EARLIER,
	read: RowRead = NO_READ,
): BoardLayout {
	return {
		...EMPTY_LAYOUT,
		active: active_rows(statuses, read),
		earlier: run_board_earlier.rows_of(earlier, statuses, read),
	}
}

// The run's scope a lane is checked against — its running issues too, which no wave holds.
function numbers_of(plan: BoardPlan): ReadonlySet<number> {
	const running = plan.waves.running ?? []

	return new Set([...children_of(plan), ...running].map((child) => child.number))
}

// Every row the layout draws, an epic's children among them — what the header counts and the legend reads.
function rows_of(layout: BoardLayout): Array<BoardRow> {
	const queued = layout.queued.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))

	return [...layout.active, ...queued, ...layout.people, ...layout.unreached]
}

// Every row the frame draws — the counted ones and the earlier run's lanes — what the legend reads.
function drawn_rows(layout: BoardLayout): Array<BoardRow> {
	return [...rows_of(layout), ...(layout.earlier ?? [])]
}

// Every row waiting on a person's decision: the touched children parked on one, then the untouched
// `needs-decision` children — what the 🙋 section draws and the header counts as a person's.
function people_of(layout: BoardLayout): Array<BoardRow> {
	const asked = layout.active.filter((row) => row.state === 'human')

	return [...asked, ...layout.people]
}

// The run's own rows `apart` does not name, then the earlier run's lanes still holding a place.
function lane_rows(layout: BoardLayout, apart: ReadonlyArray<BoardRow>): Array<BoardRow> {
	const own = layout.active.filter((row) => !apart.includes(row))

	return [...own, ...(layout.earlier ?? [])]
}

// The lanes section's rows: those neither finished nor waiting on a person's decision.
function lanes_drawn(layout: BoardLayout): Array<BoardRow> {
	const finished = layout.active.filter((row) => is_finished(row.state))

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
	drawn_rows,
	is_blocked,
	is_decision,
	is_finished,
	is_settled,
	lane_rows,
	lanes_drawn,
	layout_of,
	listed_parks,
	local_layout_of,
	people_of,
	numbers_of,
	rows_of,
	waiting_children,
}

export { run_board_layout }
export type { BoardLayout, BoardPlan, BoardRow, Overlay, QueuedEntry, ReasonOf, RowRead, RowReason }
