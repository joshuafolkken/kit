import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'
import { core_admission, type LedgerEntry } from './core-admission'
import { core_weights } from './core-weights'
import type { MachineBudget } from './machine-capacity'

// **Why a claim waits, and who is waiting** (joshuafolkken/kit#3943). A claim held back by the budget
// used to wait in silence: the command printed nothing and no board showed it, so a lane stalled on
// memory pressure read the same as one stuck. The waiting claim records its reason on its marker and
// says it once on its own output; `run:board` draws every marker still waiting. Everything here is a
// pure function of the ledger and the budget it is handed.

const WAIT_REASONS = ['cores', 'cpu', 'memory', 'pressure'] as const

type WaitReason = (typeof WAIT_REASONS)[number]

// The one wording of each reason, on the waiting command's own line; the board draws the reason as the
// header's icon instead (joshuafolkken/kit#4052).
const REASON_TEXT: Record<WaitReason, string> = {
	cores: 'not enough free cores',
	cpu: 'CPU saturated',
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

// A claim short of cores waits on the CPU when it would fit on what the ledger declares — the cores it
// lacks are taken by busy load beyond the ledger (joshuafolkken/kit#4238) — and on the ledger otherwise.
function core_reason(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): WaitReason {
	const declared = { cores: budget.cores + (budget.busy_excess ?? 0), memory_mb: Infinity }

	return core_admission.is_admitted(key, reservations, declared) ? 'cpu' : 'cores'
}

// **The cores decide first**: a claim that would not fit even with unlimited memory waits for cores;
// one that fits on cores waits for memory, named as pressure when the reading saw compression or swap.
function wait_reason(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): WaitReason {
	const cores_only = { ...budget, memory_mb: Infinity }

	if (!core_admission.is_admitted(key, reservations, cores_only)) {
		return core_reason(key, reservations, budget)
	}

	return budget.memory_pressured === true ? 'pressure' : 'memory'
}

// Why a claim is not admitted yet, or `undefined` once it is: a unit claim the budget admits only too
// narrow (`core_admission.is_too_narrow`) still waits, on the CPU — admitted, it fits what the ledger
// declares, so only busy load beyond the ledger narrowed it (`core_reason`).
function hold_reason(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
	granted: number | undefined,
): WaitReason | undefined {
	if (!core_admission.is_admitted(key, reservations, budget)) {
		return wait_reason(key, reservations, budget)
	}

	return core_admission.is_too_narrow(key, reservations, granted) ? 'cpu' : undefined
}

// **Whether only load from outside the ledger holds the claim** (joshuafolkken/kit#4982): with that load
// gone — its busy cores handed back and no run-queue overload — the claim would be admitted at a width
// that is not too narrow. A claim the ledger or memory holds is not, and waits for its room to come back.
function is_outside_held(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): boolean {
	const unloaded = {
		...budget,
		cores: budget.cores + (budget.busy_excess ?? 0),
		busy_excess: 0,
		is_overloaded: false,
	}
	const granted = core_admission.narrowed_weight(key, reservations, unloaded.cores)

	return hold_reason(key, reservations, unloaded, granted) === undefined
}

// The machine as a waiting claim reads it: the mean raw busy cores (`busy_average.mean_busy`) and the
// cores it has.
interface MachineRoom {
	busy_cores: number | undefined
	cores: number
}

// A claim no heavier than this counts as small: every static check's weight (`core-weights.ts`).
const SMALL_CLAIM_CORES = core_weights.CORE_WEIGHTS.lint

// A small claim the machine runs beside its measured load without passing its cores, unless the run
// queue reads it overloaded. An unread machine has no room to show.
function has_room(weight: number, budget: MachineBudget, room: MachineRoom): boolean {
	if (weight > SMALL_CLAIM_CORES || budget.is_overloaded === true) return false

	return room.busy_cores !== undefined && room.busy_cores + weight <= room.cores
}

// **Whether only the ledger's cores hold a small claim the machine has room for** (joshuafolkken/kit#5391):
// other lanes' claims reserve their whole weight while running below it, so a narrowed check waited out
// the cap behind them on a machine with cores to spare. Memory still holds it: with the cores unbounded
// the claim must be admitted.
function is_ledger_held_small(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
	room: MachineRoom,
): boolean {
	const own = reservations.find((entry) => entry.key === key)?.reservation

	if (own === undefined || !has_room(own.weight, budget, room)) return false

	return core_admission.is_admitted(key, reservations, { ...budget, cores: Infinity })
}

// Whether waiting on gains the claim nothing: only load outside the ledger holds it, or only the
// ledger's cores hold a small claim the machine has room for.
function is_held_in_vain(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
	room: MachineRoom,
): boolean {
	if (is_outside_held(key, reservations, budget)) return true

	return is_ledger_held_small(key, reservations, budget, room)
}

// The line a waiting command prints once, when its wait starts.
function wait_line(command: string | undefined, reason: WaitReason): string {
	return `⏳ ${command ?? 'a step'} waits for the core budget — ${REASON_TEXT[reason]}`
}

// The lanes root a checkout belongs to: a lane's parent, or the root beside a main checkout. Two
// checkouts of one repository share it; the ledger is machine-wide, so another repository's do not.
// A Claude Code worktree under a checkout reads as that checkout (`lane_paths.checkout_of`).
function lanes_root_of(checkout: string): string {
	const resolved = lane_paths.checkout_of(path.resolve(checkout))

	if (lane_paths.lane_issue_of(resolved) === undefined) return lane_paths.lane_root(resolved)

	return path.dirname(resolved)
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
	WAIT_REASONS,
	hold_reason,
	is_held_in_vain,
	is_outside_held,
	wait_line,
	wait_reason,
	waits_of,
	where_of,
}

export type { BudgetWait, MachineRoom, WaitReason }
export { core_wait }
