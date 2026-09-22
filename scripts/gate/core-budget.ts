import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

// A machine-wide weighted core budget with admission control (joshuafolkken/kit#2351).
//
// **The gate's CPU budget used to be decided once, at the gate's start, and never revisited.**
// `announce_gate_plan` counted the unit runs alive the instant it began and sized itself against that
// one reading — so the common case (nothing else in a gate yet) had every gate conclude it was alone
// and reserve the whole machine, and only a gate that *started* later deferred. Three overlapping gates
// therefore demanded thirty cores of an eleven-core machine, which is the "usually fine, occasionally
// saturates" this module removes.
//
// **The fix is admission rather than recomputation.** A heavy step declares the cores it needs, claims
// a place in a machine-wide ledger, and waits while the ledger is full — so the peak cannot exceed the
// budget by construction, and the asymmetry ("whoever started first took everything") disappears
// because a place is claimed in claim order rather than seized at start. Waiting is what replaces the
// recomputation `unit-worker-share.ts` did: a step that could not fit does not shrink, it defers.
//
// **A solo run is bit-for-bit unchanged, and that is arithmetic rather than a branch.** The gate's
// weights are its `reserved_cores` (the static checks) and its `unit_worker_cap` (the unit suite), and
// `reserved(2 + 1 + 1) + unit_cap(cores - 4)` is exactly `cores` — so a single gate's four claims sum
// to the whole budget and every one is admitted the instant it is made, with no poll and no wait. Under
// concurrency the same weights sum past the budget and the ledger is what holds the machine down.
//
// **Liveness is `process_identity`'s, reused rather than re-invented** (joshuafolkken/kit#1245). A run
// killed outright leaves its marker behind, and a ledger that trusted the file alone would fill forever
// and admit nothing. The pid-and-start-time pair a marker carries is the same identity the unit-run
// marker keeps, swept on read the moment its process is gone.

const RESERVED_PREFIX = 'josh-core-reserved-'
const RESERVED_SUFFIX = '.json'
// How often a waiting reservation re-reads the ledger: short enough that a freed place is taken up
// promptly, long enough that the wait itself burns no measurable CPU.
const POLL_INTERVAL_MS = 50
// The longest a reservation waits before it is admitted at minimum width regardless — a heavy step must
// make progress even if the budget never clears, so a leaked or wedged sibling cannot stall the machine
// for good. Two minutes is well past a unit suite's worst measured time under six-way load.
const WAIT_CAP_MS = 120_000
// The head of the ledger is always admitted, so the smallest budget worth planning against is one core.
const MIN_BUDGET = 1

const reservation_schema = z.object({
	pid: z.number(),
	process_start: z.string().optional(),
	weight: z.number(),
	claimed_at: z.number(),
})

type Reservation = z.infer<typeof reservation_schema>

interface LiveReservation {
	// The marker's filename, which is its identity in the ledger and the tiebreak when two reservations
	// share a claim time.
	key: string
	reservation: Reservation
}

interface ReserveOptions {
	budget?: number
	wait_cap_ms?: number
	poll_interval_ms?: number
	directory?: string
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

interface Handle {
	target: string
}

function marker_name(key: string): string {
	return `${RESERVED_PREFIX}${key}${RESERVED_SUFFIX}`
}

// **"Cannot tell" counts as live**, the same direction `unit-worker-share.ts` takes: being wrong that
// way costs a reservation a slower admission, while the other way admits past a run that is still there.
function is_running(reservation: Reservation): boolean {
	return process_identity.is_same_process(reservation.pid, reservation.process_start) !== false
}

function read_reservation(source: string): Reservation | undefined {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		const parsed = reservation_schema.safeParse(JSON.parse(raw))

		return parsed.success ? parsed.data : undefined
	} catch {
		return undefined
	}
}

// **A dead marker is removed, not merely skipped** — otherwise a reissued pid turns a leaked place into
// a phantom that fills the budget for good. The unlink never throws: a marker this account may not
// remove is left alone, exactly as `unit-worker-share.ts` leaves it.
function sweep_marker(source: string): void {
	try {
		stamp_file.remove_stamp(source)
	} catch {
		/* not ours to remove; counting it out is the whole requirement */
	}
}

function live_reservation(source: string): Reservation | undefined {
	const reservation = read_reservation(source)

	if (reservation === undefined) return undefined
	if (is_running(reservation)) return reservation

	sweep_marker(source)

	return undefined
}

// An unreadable temp directory answers "no other reservation", the direction that admits rather than
// stalls a run on a guess.
function marker_files(directory: string): Array<string> {
	try {
		return readdirSync(directory).filter((name) => name.startsWith(RESERVED_PREFIX))
	} catch {
		return []
	}
}

function live_reservations(directory: string = PLATFORM_TEMP_ROOT): Array<LiveReservation> {
	return marker_files(directory).flatMap((name) => {
		const reservation = live_reservation(path.join(directory, name))

		return reservation === undefined ? [] : [{ key: name, reservation }]
	})
}

// Claim order, with the filename as the tiebreak so every reader agrees on the same ledger order
// however the wall clock rounded two near-simultaneous claims.
function compare_claim(left: LiveReservation, right: LiveReservation): number {
	const by_time = left.reservation.claimed_at - right.reservation.claimed_at

	return by_time === 0 ? left.key.localeCompare(right.key) : by_time
}

// **The keys admitted under FIFO.** The head always runs — a single check heavier than the whole
// machine must not wait for room that will never come — and each later reservation runs while the
// cumulative weight ahead of it still fits the budget. The first that does not fit stops the walk, so a
// place is never jumped: admission is in claim order, which is what removes the start-time asymmetry.
function admitted_keys(reservations: ReadonlyArray<LiveReservation>, budget: number): Set<string> {
	const admitted = new Set<string>()
	let cumulative = 0

	for (const [index, entry] of reservations.toSorted(compare_claim).entries()) {
		cumulative += entry.reservation.weight

		if (index !== 0 && cumulative > budget) break

		admitted.add(entry.key)
	}

	return admitted
}

function is_admitted(
	key: string,
	reservations: ReadonlyArray<LiveReservation>,
	budget: number,
): boolean {
	return admitted_keys(reservations, budget).has(key)
}

// The weight actually running at once — what the reproduction test asserts stays within the budget.
function admitted_load(reservations: ReadonlyArray<LiveReservation>, budget: number): number {
	const admitted = admitted_keys(reservations, budget)

	return reservations
		.filter((entry) => admitted.has(entry.key))
		.reduce((total, entry) => total + entry.reservation.weight, 0)
}

// `Math.max` propagates `NaN` rather than clamping it, so an unusable budget is caught before it could
// make every comparison false and admit everything — the hole `gate-plan.ts` closes for the same reason.
function normalize_budget(budget: number): number {
	return Number.isFinite(budget) ? Math.max(MIN_BUDGET, Math.floor(budget)) : MIN_BUDGET
}

async function default_sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

function write_reservation(target: string, weight: number, claimed_at: number): void {
	stamp_file.write_stamp(target, { ...process_identity.own_fields(), weight, claimed_at })
}

// The clock and cadence a wait runs on, resolved apart from the ledger fields so `reserve` stays under
// the complexity limit — each default is a branch, and six in one function is past it.
interface TimingConfig {
	now: () => number
	sleep: (ms: number) => Promise<void>
	poll_interval_ms: number
}

interface WaitContext extends TimingConfig {
	key: string
	directory: string
	budget: number
	deadline: number
}

function resolve_timing(options: ReserveOptions): TimingConfig {
	return {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? default_sleep,
		poll_interval_ms: options.poll_interval_ms ?? POLL_INTERVAL_MS,
	}
}

// Poll the ledger until this reservation is admitted, or until the wait cap admits it at minimum width.
// A solo run is admitted on the first read — its own claim is the ledger's head — so the loop body never
// runs and the wait costs nothing.
async function await_admission(context: WaitContext): Promise<void> {
	while (!is_admitted(context.key, live_reservations(context.directory), context.budget)) {
		if (context.now() >= context.deadline) return

		await context.sleep(context.poll_interval_ms)
	}
}

async function reserve(weight: number, options: ReserveOptions = {}): Promise<Handle> {
	const timing = resolve_timing(options)
	const directory = options.directory ?? PLATFORM_TEMP_ROOT
	const budget = normalize_budget(options.budget ?? availableParallelism())
	const claimed_at = timing.now()
	const name = marker_name(randomUUID())
	const target = path.join(directory, name)

	write_reservation(target, weight, claimed_at)
	await await_admission({
		...timing,
		key: name,
		directory,
		budget,
		deadline: claimed_at + (options.wait_cap_ms ?? WAIT_CAP_MS),
	})

	return { target }
}

function release(handle: Handle): void {
	sweep_marker(handle.target)
}

// The whole reservation lifetime around a step: claim a place, wait for admission, run, and free the
// place on any exit. `finally`, so a step that threw still releases its cores.
async function with_core_reservation<T>(
	weight: number,
	run: () => Promise<T>,
	options: ReserveOptions = {},
): Promise<T> {
	const handle = await reserve(weight, options)

	try {
		return await run()
	} finally {
		release(handle)
	}
}

const core_budget = {
	MIN_BUDGET,
	POLL_INTERVAL_MS,
	RESERVED_PREFIX,
	WAIT_CAP_MS,
	admitted_keys,
	admitted_load,
	is_admitted,
	is_running,
	live_reservations,
	read_reservation,
	release,
	reserve,
	with_core_reservation,
}

export type { LiveReservation, Reservation, ReserveOptions }
export { core_budget }
