import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'

// Where each waiting child lands on the lanes (joshuafolkken/kit#4319): onto the lane that frees
// first, but never before what it waits on ends — a 🔗 blocker, the 📂 child holding its path, the
// running lanes a 🧍 `run:solo` child waits out, the 🙅 solo child ahead of it, the 📋 issue a named run
// starts it after — nor before a `run:solo` child ends: a running one, or a 🧍 one placed ahead, which
// itself starts once every lane placed before it has freed. A child waiting on an issue the board does
// not carry waits past this run, so it is left out.

const { WAIT_ICONS } = run_board_labels
const AFTER_ICONS: ReadonlySet<string> = new Set([
	WAIT_ICONS.path,
	WAIT_ICONS.solo,
	WAIT_ICONS.solo_ahead,
	WAIT_ICONS.named,
])

interface Lanes {
	// When each lane frees, from now.
	free: Array<number>
	// When each child on the board ends, from now.
	ends: Map<number, number>
	// No waiting child starts before this — the end of a `run:solo` child running or placed.
	floor: number
	per_child: number
}

interface Pending {
	number: number
	after: ReadonlyArray<number>
	// A 🧍 `run:solo` child: it starts once every lane is free and lets none start beside it.
	is_solo: boolean
}

// The issues a row's reason says it starts after, none for a wait no child's end lifts.
function named_of(reason: BoardRow['reason']): ReadonlyArray<string> {
	if (reason?.icon === undefined || !AFTER_ICONS.has(reason.icon)) return []

	return reason.issues ?? []
}

// The issues a waiting row starts after: its standing blockers, and those its reason names.
function pending_of(row: BoardRow): Pending {
	const after = new Set([...row.waits, ...named_of(row.reason)])

	const is_solo = row.reason?.icon === WAIT_ICONS.solo

	return { number: row.number, after: [...after].map(Number), is_solo }
}

function is_ready(pending: Pending, lanes: Lanes): boolean {
	return pending.after.every((issue) => lanes.ends.has(issue))
}

// The lane freeing latest by the time the child can start, so a child waiting on an end leaves the
// lane free sooner to a child ready before it; the lane free first where none has freed by then.
function lane_for(free: ReadonlyArray<number>, ready: number): number {
	const fits = free.filter((at) => at <= ready)

	return free.indexOf(fits.length > 0 ? Math.max(...fits) : Math.min(...free))
}

function place(pending: Pending, lanes: Lanes): void {
	const waited = pending.after.map((issue) => lanes.ends.get(issue) ?? 0)
	const busy = pending.is_solo ? lanes.free : []
	const ready = Math.max(lanes.floor, ...waited, ...busy)
	const lane = lane_for(lanes.free, ready)
	const end = Math.max(lanes.free[lane] ?? 0, ready) + lanes.per_child

	lanes.free[lane] = end
	lanes.ends.set(pending.number, end)
	if (pending.is_solo) lanes.floor = end
}

// One pass over the children not yet placed, placing each whose waits have ended; the rest are left.
function pass(pending: ReadonlyArray<Pending>, lanes: Lanes): Array<Pending> {
	const ready = pending.filter((entry) => is_ready(entry, lanes))

	for (const entry of ready) place(entry, lanes)

	return pending.filter((entry) => !lanes.ends.has(entry.number))
}

// The time the last lane ends, the waiting rows placed pass after pass until a pass places none.
function end_of(waiting: ReadonlyArray<BoardRow>, lanes: Lanes): number {
	let left = waiting.map((row) => pending_of(row))
	let placed = Infinity

	while (left.length > 0 && placed > 0) {
		const next = pass(left, lanes)

		placed = left.length - next.length
		left = next
	}

	return Math.max(...lanes.free)
}

const run_board_estimate_schedule = { end_of }

export { run_board_estimate_schedule }
export type { Lanes }
