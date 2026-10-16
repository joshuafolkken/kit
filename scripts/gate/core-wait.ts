import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'
import { core_admission, type LedgerEntry } from './core-admission'
import type { MachineBudget } from './machine-capacity'

// **Why a claim waits, and who is waiting** (joshuafolkken/kit#3943). A claim held back by the budget
// used to wait in silence: the command printed nothing and no board showed it, so a lane stalled on
// memory pressure read the same as one stuck. The waiting claim records its reason on its marker and
// says it once on its own output; `run:board` draws every marker still waiting. Everything here is a
// pure function of the ledger and the budget it is handed.

const WAIT_REASONS = ['cores', 'memory', 'pressure'] as const

type WaitReason = (typeof WAIT_REASONS)[number]

// The one wording of each reason, shared by the waiting command's line and the board's.
const REASON_TEXT: Record<WaitReason, string> = {
	cores: 'not enough free cores',
	memory: 'not enough free memory',
	pressure: 'memory under pressure',
}

// What the board reads off a marker. Every field but the claim time is optional, so a marker an older
// `josh` wrote still reads, and one that never waited is not drawn.
interface WhereFields {
	checkout?: string | undefined
	lane?: string | undefined
	lanes_root?: string | undefined
}

interface WaitMarker extends WhereFields {
	claimed_at: number
	admitted_at?: number | undefined
	command?: string | undefined
	wait_reason?: WaitReason | undefined
}

// Where a waiting claim runs: `lane` is the board's own repository's lane number, which the board
// links; `elsewhere` names another repository's checkout, which it cannot link. Neither is the board's
// own main checkout.
interface BudgetPlace {
	lane: string | undefined
	elsewhere: string | undefined
}

interface BudgetWait extends BudgetPlace {
	command: string | undefined
	waited_ms: number
	reason: WaitReason
}

// **The cores decide first**: a claim that would not fit even with unlimited memory waits for cores;
// one that fits on cores waits for memory, named as pressure when the reading saw compression or swap.
function wait_reason(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): WaitReason {
	const cores_only = { cores: budget.cores, memory_mb: Infinity }

	if (!core_admission.is_admitted(key, reservations, cores_only)) return 'cores'

	return budget.memory_pressured === true ? 'pressure' : 'memory'
}

// The line a waiting command prints once, when its wait starts.
function wait_line(command: string | undefined, reason: WaitReason): string {
	return `⏳ ${command ?? 'a step'} waits for the core budget — ${REASON_TEXT[reason]}`
}

// The lanes root a checkout belongs to: a lane's parent, or the root beside a main checkout. Two
// checkouts of one repository share it; the ledger is machine-wide, so another repository's do not.
function lanes_root_of(checkout: string): string {
	if (lane_paths.lane_issue_of(checkout) === undefined) return lane_paths.lane_root(checkout)

	return path.dirname(path.resolve(checkout))
}

// Where a claim runs, read by the claimer under its own environment: `JOSH_LANE_ROOT` is a
// per-project setting, so a board cannot derive another repository's lanes root from its own.
function where_of(checkout: string): Required<WhereFields> {
	return { checkout, lane: lane_paths.lane_issue_of(checkout), lanes_root: lanes_root_of(checkout) }
}

// Another repository's checkout is named by its lanes root and lane, or its directory, so its lane
// number is never linked to the board's repository's issue of that number.
function place_of(marker: WhereFields, home_root: string): BudgetPlace {
	const { checkout, lane, lanes_root } = marker

	if (checkout === undefined || lanes_root === undefined || lanes_root === home_root) {
		return { lane, elsewhere: undefined }
	}

	const name = lane === undefined ? path.basename(checkout) : `${path.basename(lanes_root)}/${lane}`

	return { lane: undefined, elsewhere: name }
}

function wait_of(marker: WaitMarker, now: number, home_root: string): Array<BudgetWait> {
	const { command, wait_reason: reason } = marker

	if (reason === undefined || marker.admitted_at !== undefined) return []

	return [{ command, ...place_of(marker, home_root), waited_ms: now - marker.claimed_at, reason }]
}

// The claims still waiting, longest first, placed against the board's checkout `home`.
function waits_of(
	entries: ReadonlyArray<{ reservation: WaitMarker }>,
	now: number,
	home: string,
): Array<BudgetWait> {
	const home_root = lanes_root_of(home)

	return entries
		.flatMap((entry) => wait_of(entry.reservation, now, home_root))
		.toSorted((left, right) => right.waited_ms - left.waited_ms)
}

const core_wait = {
	REASON_TEXT,
	WAIT_REASONS,
	wait_line,
	wait_reason,
	waits_of,
	where_of,
}

export type { BudgetWait, WaitReason }
export { core_wait }
