import { backlog_plan, type PlanContext } from '#scripts/backlog/backlog-plan'
import type { WavePlan } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { issue_cite } from '#scripts/issue/issue-cite'
import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import type { FiledKind } from '#scripts/run/event/run-event-filed'
import { run_board_kind } from './run-board-kind'
import type { ItemState, ItemStatus } from './run-board-status'

// The plan with each issue's status laid over it — pure, so the order the board
// draws is tested apart from the screen. **The order is the plan's**: the waves are `backlog_waves.build`'s,
// the same play-forward `backlog:plan --waves` prints, so a merge, a park or a new arrival that changes the
// plan changes the board with it. The plan leaves out what a run already holds or has closed, so those
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
}

interface BoardRow {
	number: number
	title: string | undefined
	// The release category its labels place it in (joshuafolkken/kit#3577), none for an Other Change.
	kind: FiledKind | undefined
	state: ItemState
	status: ItemStatus | undefined
	// The standing blockers this row still waits on, as the plan names them.
	waits: ReadonlyArray<string>
}

type WaveEntry =
	| { kind: 'row'; row: BoardRow }
	| { kind: 'epic'; epic: number; title: string | undefined; rows: Array<BoardRow> }

interface BoardLayout {
	active: ReadonlyArray<BoardRow>
	waves: ReadonlyArray<ReadonlyArray<WaveEntry>>
	people: ReadonlyArray<BoardRow>
	unreached: ReadonlyArray<BoardRow>
}

// What an active row is named and classified by — each issue's title and labels.
interface RowRead {
	titles: ReadonlyMap<number, string>
	labels: ReadonlyMap<number, ReadonlyArray<string>>
}

interface Overlay {
	plan: BoardPlan
	statuses: ReadonlyMap<number, ItemStatus>
}

const SETTLED_STATES: ReadonlySet<ItemState> = new Set(['merged', 'parked', 'done'])

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

function plan_row(child: EpicChild, state: ItemState, overlay: Overlay): BoardRow {
	const { context } = overlay.plan
	const waits = child.blocked_by
		.filter((edge) => is_waiting_on(edge, overlay))
		.map((edge) => reference_of(edge, context.repo))

	return {
		number: child.number,
		title: context.titles.get(child.number),
		kind: run_board_kind.kind_of(child.labels),
		state,
		status: undefined,
		waits,
	}
}

function started_of(row: BoardRow): number {
	return row.status?.started_ms ?? Infinity
}

// Every child the run has touched, in the order each started.
function active_rows(statuses: ReadonlyMap<number, ItemStatus>, read: RowRead): Array<BoardRow> {
	const rows = [...statuses].map(([number, status]) => ({
		number,
		title: read.titles.get(number),
		kind: run_board_kind.kind_of(read.labels.get(number)),
		state: status.state,
		status,
		waits: [],
	}))

	return rows.toSorted((left, right) => started_of(left) - started_of(right))
}

// The epic row carries its own title, read from the same open listing as its children's — an opted-in
// epic is an open issue.
function place_in_epic(
	entries: Array<WaveEntry>,
	epic: number,
	overlay: Overlay,
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

function is_human(child: EpicChild): boolean {
	return has_label_name(child.labels, NEEDS_DECISION_LABEL)
}

// A wave row waits, unless it waits on a person's decision — the one wait the board marks.
function wave_state(child: EpicChild): ItemState {
	return is_human(child) ? 'human' : 'waiting'
}

// One wave, its rows in the plan's order, an epic's children gathered under the epic where the first
// of them falls.
function wave_entries(wave: ReadonlyArray<EpicChild>, overlay: Overlay): Array<WaveEntry> {
	const entries: Array<WaveEntry> = []

	for (const child of wave) {
		const row = plan_row(child, wave_state(child), overlay)
		const epic = overlay.plan.tracked.get(child.number)

		if (epic === undefined) entries.push({ kind: 'row', row })
		else place_in_epic(entries, epic, overlay, row)
	}

	return entries
}

function unreached_rows(overlay: Overlay, is_people: boolean): Array<BoardRow> {
	const state: ItemState = is_people ? 'human' : 'waiting'

	return overlay.plan.waves.unreached
		.filter((child) => is_untouched(child, overlay) && is_human(child) === is_people)
		.map((child) => plan_row(child, state, overlay))
}

function layout_of(plan: BoardPlan, statuses: ReadonlyMap<number, ItemStatus>): BoardLayout {
	const overlay = { plan, statuses }
	const waves = plan.waves.waves.map((wave) =>
		wave_entries(
			wave.filter((child) => is_untouched(child, overlay)),
			overlay,
		),
	)

	return {
		active: active_rows(statuses, { titles: plan.context.titles, labels: plan.labels }),
		waves: waves.filter((wave) => wave.length > 0),
		people: unreached_rows(overlay, true),
		unreached: unreached_rows(overlay, false),
	}
}

const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }

// The run's own children before the plan is read: the stream and the lanes are local and read at
// once, so the rows, their states and how long each has run are drawn while GitHub answers; the titles
// and every issue the run has not touched wait for the plan.
function local_layout_of(statuses: ReadonlyMap<number, ItemStatus>): BoardLayout {
	return {
		...EMPTY_LAYOUT,
		active: active_rows(statuses, { titles: new Map(), labels: new Map() }),
	}
}

// Every issue the plan holds, wave or unreached — the run's scope a lane is checked against.
function numbers_of(plan: BoardPlan): ReadonlySet<number> {
	return new Set([...plan.waves.waves.flat(), ...plan.waves.unreached].map((child) => child.number))
}

// Every row the layout draws, an epic's children among them — what the header counts and the legend reads.
function rows_of(layout: BoardLayout): Array<BoardRow> {
	const waves = layout.waves
		.flat()
		.flatMap((entry) => (entry.kind === 'row' ? [entry.row] : entry.rows))

	return [...layout.active, ...waves, ...layout.people, ...layout.unreached]
}

const run_board_layout = {
	EMPTY_LAYOUT,
	is_settled,
	layout_of,
	local_layout_of,
	numbers_of,
	rows_of,
}

export { run_board_layout }
export type { BoardLayout, BoardPlan, BoardRow, WaveEntry }
