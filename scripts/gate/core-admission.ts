import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import type { LedgerLoad, MachineBudget } from './machine-capacity'

// The ledger's admission arithmetic, kept apart from the markers `core-budget.ts` reads and writes so
// that file stays under its line ceiling as the budget grew a memory side.
// Everything here is a pure function of the ledger it is handed.

// **How long an admitted claim's tool takes to reach its declared peak.** The machine reading holds only
// what a tool has already allocated, so a claim admitted moments ago is not in it yet: adding its
// declared memory back would admit the next claim into memory about to be taken — the concurrent start
// this ledger exists to stop. Until the window passes, the claim's memory counts only in `is_admitted`; a
// tool partway up is then counted twice, which costs a slower admission, never a swap. Its cores are in
// the reading from the start, so the window does not apply to them.
const RAMP_UP_MS = 30_000
// How long after a waiting claim's own claim a lighter claim may still pass it (`may_pass`): long
// enough for the related checks an edit triggers together, short enough that a heavy claim waits only
// for the claims already in flight.
const BYPASS_WINDOW_MS = 30_000
// A narrowed unit claim still runs one worker: zero would run no test and report the suite green.
const MIN_GRANT = 1

// What admission reads from a marker. `memory_mb` and `admitted_at` are optional because a marker an
// older `josh` wrote has neither: it declares no memory, and it counts as load from outside the ledger.
// `granted` is the narrower weight a unit claim was admitted at past the wait cap; once set, it is the
// load the claim holds.
interface LedgerReservation {
	weight: number
	claimed_at: number
	memory_mb?: number | undefined
	admitted_at?: number | undefined
	granted?: number | undefined
	is_unit?: boolean | undefined
}

interface LedgerEntry {
	// The marker's filename, which is its identity in the ledger and the tiebreak when two reservations
	// share a claim time.
	key: string
	reservation: LedgerReservation
}

// A claim admitted at the wait cap rather than by room in the budget — the run went ahead past the
// budget, and the gate's summary says so.
interface Overflow {
	waited_ms: number
	ledger: LedgerLoad
	budget: MachineBudget
}

// `granted` is set only when a unit claim was narrowed to the room left at the wait cap.
interface Admission {
	overflow: Overflow | undefined
	granted?: number | undefined
}

// Claim order, with the filename as the tiebreak so every reader agrees on the same ledger order
// however the wall clock rounded two near-simultaneous claims.
function compare_claim(left: LedgerEntry, right: LedgerEntry): number {
	const by_time = left.reservation.claimed_at - right.reservation.claimed_at

	return by_time === 0 ? left.key.localeCompare(right.key) : by_time
}

function add_load(totals: LedgerLoad, reservation: LedgerReservation): void {
	totals.cores += reservation.granted ?? reservation.weight
	totals.memory_mb += reservation.memory_mb ?? 0
}

function exceeds(totals: LedgerLoad, budget: LedgerLoad): boolean {
	return totals.cores > budget.cores || totals.memory_mb > budget.memory_mb
}

function sum_load(reservations: ReadonlyArray<LedgerEntry>): LedgerLoad {
	const load = { cores: 0, memory_mb: 0 }

	for (const entry of reservations) add_load(load, entry.reservation)

	return load
}

function is_waiting(entry: LedgerEntry): boolean {
	return entry.reservation.admitted_at === undefined
}

function fits(entries: ReadonlyArray<LedgerEntry>, limit: LedgerLoad): boolean {
	return !exceeds(sum_load(entries), limit)
}

// Where a claim stands in the ledger: the claims already running, whatever their place, and the
// claims still waiting ahead of it in claim order.
interface Placement {
	own: LedgerEntry
	is_oldest: boolean
	ahead: Array<LedgerEntry>
	running: Array<LedgerEntry>
}

function place(key: string, reservations: ReadonlyArray<LedgerEntry>): Placement | undefined {
	const ordered = reservations.toSorted(compare_claim)
	const index = ordered.findIndex((entry) => entry.key === key)
	const own = ordered[index]

	if (own === undefined) return undefined

	return {
		own,
		is_oldest: index === 0,
		ahead: ordered.slice(0, index).filter((entry) => is_waiting(entry)),
		running: ordered.filter((entry) => entry.key !== key && !is_waiting(entry)),
	}
}

// **The first waiting claim is held by the ledger, never by load from outside it**
// (joshuafolkken/kit#4313). Holding it on `busy_excess` (joshuafolkken/kit#4238) made a solo gate's unit
// claim wait out the cap behind one core of Claude sessions or editor load — work deferred, not removed.
// It is admitted against the cores the ledger leaves, and a unit claim narrows to the room the outside
// load leaves (`narrowed_weight`), so that load bounds its workers instead of its start.
function first_waiter_limit(budget: MachineBudget): LedgerLoad {
	return { cores: budget.cores + (budget.busy_excess ?? 0), memory_mb: budget.memory_mb }
}

// **A light claim passes a waiting one only within a window of that one's claim** (#4313). A claim that
// fits the room the running claims leave runs instead of queueing behind a heavier claim that does not
// fit it; a claim made more than the window after a waiter queues behind it, so a waiter is passed by a
// bounded set of claims and is never starved.
function may_pass({ own, ahead, running }: Placement, budget: MachineBudget): boolean {
	const latest = own.reservation.claimed_at - BYPASS_WINDOW_MS
	const is_recent = ahead.every((entry) => entry.reservation.claimed_at > latest)

	return is_recent && fits([...running, own], budget)
}

function fits_in_order({ own, ahead, running }: Placement, budget: MachineBudget): boolean {
	const limit = ahead.length === 0 ? first_waiter_limit(budget) : budget

	return fits([...running, ...ahead, own], limit)
}

// **Admission: the oldest claim runs once nothing else does, then claim order, then a bounded pass.**
// The oldest runs because a single check heavier than the whole machine must not wait for room that will
// never come; claims that passed it are still running beside it, and their room does come back, so it
// waits for them rather than starting on top of their cores and memory. A later claim runs when every
// running claim, every claim waiting ahead of it and its own load fit the budget — the first waiter
// against the ledger alone (`first_waiter_limit`) — or when it may pass the waiters ahead (`may_pass`).
function is_admitted(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): boolean {
	const placement = place(key, reservations)

	if (placement === undefined) return false
	if (placement.is_oldest && placement.running.length === 0) return true

	return fits_in_order(placement, budget) || may_pass(placement, budget)
}

function mark_admitted(entries: Array<LedgerEntry>, key: string): void {
	const index = entries.findIndex((entry) => entry.key === key)
	const entry = entries[index]

	if (entry === undefined) return

	entries[index] = {
		...entry,
		reservation: { ...entry.reservation, admitted_at: entry.reservation.claimed_at },
	}
}

// **The keys one round of polls admits**, each claim polling in claim order and reading the ledger the
// claims before it left — an admitted claim is running for every claim after it, as its marker is.
function admitted_keys(
	reservations: ReadonlyArray<LedgerEntry>,
	budget: number,
	memory_budget = Infinity,
): Set<string> {
	const limit = { cores: budget, memory_mb: memory_budget }
	const ledger = [...reservations]
	const admitted = new Set<string>()

	for (const { key } of reservations.toSorted(compare_claim)) {
		if (!is_admitted(key, ledger, limit)) continue

		admitted.add(key)
		mark_admitted(ledger, key)
	}

	return admitted
}

function is_ramped(reservation: LedgerReservation, now: number): boolean {
	const { admitted_at } = reservation

	return admitted_at !== undefined && now - admitted_at >= RAMP_UP_MS
}

// **The load the ledger already accounts for.** CPU use shows in the reading the moment a tool starts,
// so every admitted claim's cores count at once; memory grows as the tool allocates, so only the claims
// admitted long enough ago to be in the reading count their memory.
function ledger_load(reservations: ReadonlyArray<LedgerEntry>, now: number): LedgerLoad {
	const admitted = reservations.filter((entry) => entry.reservation.admitted_at !== undefined)
	const ramped = admitted.filter((entry) => is_ramped(entry.reservation, now))

	return { cores: sum_load(admitted).cores, memory_mb: sum_load(ramped).memory_mb }
}

function total_weight(reservations: ReadonlyArray<LedgerEntry>): number {
	return sum_load(reservations).cores
}

// **The weight a unit claim admitted past the wait cap may take: the cores the admitted claims leave
// free, never below one worker and never above what it asked for.** Admitting it at full width put the
// ledger past the machine (joshuafolkken/kit#4235); a unit suite is the one tool whose width follows a
// number, so it narrows instead. `undefined` for any other claim, and for one that fits as asked.
function narrowed_weight(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: number,
): number | undefined {
	const own = reservations.find((entry) => entry.key === key)?.reservation

	if (own?.is_unit !== true) return undefined

	const others = reservations.filter(
		(entry) => entry.key !== key && entry.reservation.admitted_at !== undefined,
	)
	const room = Math.max(MIN_GRANT, Math.floor(budget - total_weight(others)))

	return room >= own.weight ? undefined : room
}

// The ledger as it stands once `key` is admitted at `granted`, so the overflow it reports counts the
// narrowed weight rather than the one the claim asked for.
function with_grant<T extends LedgerEntry>(
	key: string,
	reservations: ReadonlyArray<T>,
	granted: number | undefined,
): Array<T> {
	if (granted === undefined) return [...reservations]

	return reservations.map((entry) =>
		entry.key === key ? { ...entry, reservation: { ...entry.reservation, granted } } : entry,
	)
}

// The weight actually running at once — what the reproduction test asserts stays within the budget.
function admitted_load(reservations: ReadonlyArray<LedgerEntry>, budget: number): number {
	const admitted = admitted_keys(reservations, budget)

	return total_weight(reservations.filter((entry) => admitted.has(entry.key)))
}

// The memory side of an overflow, so a claim held back by memory is not reported as a core shortfall.
// A budget that read no memory set no memory limit, and says nothing.
function describe_memory(ledger: LedgerLoad, budget: MachineBudget): string {
	if (!Number.isFinite(budget.memory_mb)) return ''

	return ` and ${String(Math.round(ledger.memory_mb))} MB of memory against ${String(Math.round(budget.memory_mb))} MB`
}

// The summary line for a claim admitted past the budget, or undefined for one that fitted.
function describe_overflow(admission: Admission): string | undefined {
	const { overflow } = admission

	if (overflow === undefined) return undefined

	const { ledger, budget } = overflow
	const waited = String(Math.round(overflow.waited_ms / MS_PER_SECOND))
	const cores = `the ledger held ${String(ledger.cores)} cores against a budget of ${String(budget.cores)}`

	return `started past the core budget after ${waited}s — ${cores}${describe_memory(ledger, budget)}`
}

const core_admission = {
	BYPASS_WINDOW_MS,
	RAMP_UP_MS,
	admitted_keys,
	admitted_load,
	describe_overflow,
	is_admitted,
	ledger_load,
	narrowed_weight,
	sum_load,
	with_grant,
}

export type { Admission, LedgerEntry, Overflow }
export { core_admission }
