import type { LedgerLoad, MachineBudget } from './machine-capacity'

// The ledger's admission arithmetic, kept apart from the markers `core-budget.ts` reads and writes so
// that file stays under its line ceiling as the budget grew a memory side.
// Everything here is a pure function of the ledger it is handed.

const MS_PER_SECOND = 1000
// **How long an admitted claim's tool takes to reach its declared peak.** The machine reading holds only
// what a tool has already allocated, so a claim admitted moments ago is not in it yet: adding its
// declared memory back would admit the next claim into memory about to be taken — the concurrent start
// this ledger exists to stop. Until the window passes, the claim's memory counts only in the FIFO walk; a
// tool partway up is then counted twice, which costs a slower admission, never a swap. Its cores are in
// the reading from the start, so the window does not apply to them.
const RAMP_UP_MS = 30_000

// What admission reads from a marker. `memory_mb` and `admitted_at` are optional because a marker an
// older `josh` wrote has neither: it declares no memory, and it counts as load from outside the ledger.
interface LedgerReservation {
	weight: number
	claimed_at: number
	memory_mb?: number | undefined
	admitted_at?: number | undefined
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

interface Admission {
	overflow: Overflow | undefined
}

// Claim order, with the filename as the tiebreak so every reader agrees on the same ledger order
// however the wall clock rounded two near-simultaneous claims.
function compare_claim(left: LedgerEntry, right: LedgerEntry): number {
	const by_time = left.reservation.claimed_at - right.reservation.claimed_at

	return by_time === 0 ? left.key.localeCompare(right.key) : by_time
}

function add_load(totals: LedgerLoad, reservation: LedgerReservation): void {
	totals.cores += reservation.weight
	totals.memory_mb += reservation.memory_mb ?? 0
}

function exceeds(totals: LedgerLoad, budget: MachineBudget): boolean {
	return totals.cores > budget.cores || totals.memory_mb > budget.memory_mb
}

// **The keys admitted under FIFO.** The head always runs — a single check heavier than the whole
// machine must not wait for room that will never come — and each later reservation runs while the
// cumulative weight ahead of it still fits the budget. The first that does not fit stops the walk, so a
// place is never jumped: admission is in claim order, which is what removes the start-time asymmetry.
// Memory is walked the same way, so a claim whose tool would not fit in free memory waits like one whose
// cores would not fit.
function admitted_keys(
	reservations: ReadonlyArray<LedgerEntry>,
	budget: number,
	memory_budget = Infinity,
): Set<string> {
	const limit = { cores: budget, memory_mb: memory_budget }
	const totals = { cores: 0, memory_mb: 0 }
	const admitted = new Set<string>()

	for (const [index, entry] of reservations.toSorted(compare_claim).entries()) {
		add_load(totals, entry.reservation)

		if (index !== 0 && exceeds(totals, limit)) break

		admitted.add(entry.key)
	}

	return admitted
}

function is_admitted(
	key: string,
	reservations: ReadonlyArray<LedgerEntry>,
	budget: MachineBudget,
): boolean {
	return admitted_keys(reservations, budget.cores, budget.memory_mb).has(key)
}

function sum_load(reservations: ReadonlyArray<LedgerEntry>): LedgerLoad {
	const load = { cores: 0, memory_mb: 0 }

	for (const entry of reservations) add_load(load, entry.reservation)

	return load
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
	RAMP_UP_MS,
	admitted_keys,
	admitted_load,
	describe_overflow,
	is_admitted,
	ledger_load,
	sum_load,
}

export type { Admission, LedgerEntry, Overflow }
export { core_admission }
