import { backlog_plan, type PlanContext } from '#scripts/backlog/backlog-plan'
import type { WavePlan } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { IssueReference } from '#scripts/epic/epic-reference'
import { has_label_name, NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import type { ItemState, ItemStatus } from './run-board-status'

// The plan with each issue's status laid over it (joshuafolkken/kit#3430) — pure, so the order the board
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
}

interface BoardRow {
	number: number
	title: string | undefined
	state: ItemState
	status: ItemStatus | undefined
	// The standing blockers this row still waits on, as the plan names them.
	waits: ReadonlyArray<string>
}

type WaveEntry =
	{ kind: 'row'; row: BoardRow } | { kind: 'epic'; epic: number; rows: Array<BoardRow> }

interface BoardLayout {
	active: ReadonlyArray<BoardRow>
	waves: ReadonlyArray<ReadonlyArray<WaveEntry>>
	people: ReadonlyArray<BoardRow>
	unreached: ReadonlyArray<BoardRow>
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
	return edge.repo === repo ? String(edge.number) : `${edge.repo}#${String(edge.number)}`
}

function plan_row(child: EpicChild, state: ItemState, overlay: Overlay): BoardRow {
	const { context } = overlay.plan
	const waits = child.blocked_by
		.filter((edge) => is_waiting_on(edge, overlay))
		.map((edge) => reference_of(edge, context.repo))

	return {
		number: child.number,
		title: context.titles.get(child.number),
		state,
		status: undefined,
		waits,
	}
}

function started_of(row: BoardRow): number {
	return row.status?.started_ms ?? Infinity
}

// Every child the run has touched, in the order each started.
function active_rows(overlay: Overlay): Array<BoardRow> {
	const rows = [...overlay.statuses].map(([number, status]) => ({
		number,
		title: overlay.plan.context.titles.get(number),
		state: status.state,
		status,
		waits: [],
	}))

	return rows.toSorted((left, right) => started_of(left) - started_of(right))
}

function place_in_epic(entries: Array<WaveEntry>, epic: number, row: BoardRow): void {
	const group = entries.find((entry) => entry.kind === 'epic' && entry.epic === epic)

	if (group?.kind === 'epic') group.rows.push(row)
	else entries.push({ kind: 'epic', epic, rows: [row] })
}

// One wave, its rows in the plan's order, an epic's children gathered under the epic where the first
// of them falls.
function wave_entries(wave: ReadonlyArray<EpicChild>, overlay: Overlay): Array<WaveEntry> {
	const entries: Array<WaveEntry> = []

	for (const child of wave) {
		const row = plan_row(child, 'waiting', overlay)
		const epic = overlay.plan.tracked.get(child.number)

		if (epic === undefined) entries.push({ kind: 'row', row })
		else place_in_epic(entries, epic, row)
	}

	return entries
}

function is_untouched(child: EpicChild, overlay: Overlay): boolean {
	return !overlay.statuses.has(child.number)
}

function is_human(child: EpicChild): boolean {
	return has_label_name(child.labels, NEEDS_DECISION_LABEL)
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
		active: active_rows(overlay),
		waves: waves.filter((wave) => wave.length > 0),
		people: unreached_rows(overlay, true),
		unreached: unreached_rows(overlay, false),
	}
}

// Every issue the plan holds, wave or unreached — the run's scope a lane is checked against.
function numbers_of(plan: BoardPlan): ReadonlySet<number> {
	return new Set([...plan.waves.waves.flat(), ...plan.waves.unreached].map((child) => child.number))
}

const run_board_layout = { is_settled, layout_of, numbers_of }

export { run_board_layout }
export type { BoardLayout, BoardPlan, BoardRow, WaveEntry }
