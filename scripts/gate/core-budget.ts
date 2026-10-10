import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import path from 'node:path'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { process_identity } from '#scripts/josh/process-identity'
import { process_owner_schema } from '#scripts/josh/process-owner'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { z } from 'zod'
import { core_admission, type Admission, type LedgerEntry, type Overflow } from './core-admission'
import { machine_capacity, type MachineBudget, type MachineReading } from './machine-capacity'

// A machine-wide weighted core budget with admission control.
//
// **Admission rather than a budget sized once at the gate's start.** A budget read once at the start
// has every gate that sees no sibling conclude it is alone and reserve the whole machine, so
// overlapping gates oversubscribe it. Instead a heavy step declares the cores it needs, claims a place
// in a machine-wide ledger, and waits while the ledger is full — so the peak cannot exceed the budget
// by construction, and a place is claimed in claim order rather than seized at start. A step that
// could not fit does not shrink, it defers.
//
// **A solo run is bit-for-bit unchanged, and that is arithmetic rather than a branch.** The gate's
// weights are its `reserved_cores` (the static checks) and its `unit_worker_cap` (the unit suite), and
// `reserved(2 + 1 + 1) + unit_cap(cores - 4)` is exactly `cores` — so a single gate's four claims sum
// to the whole budget and every one is admitted the instant it is made, with no poll and no wait. Under
// concurrency the same weights sum past the budget and the ledger is what holds the machine down.
//
// **Liveness is `process_identity`'s, reused rather than re-invented.** A run
// killed outright leaves its marker behind, and a ledger that trusted the file alone would fill forever
// and admit nothing. The pid-and-start-time pair a marker carries is the same identity the unit-run
// marker keeps, swept on read the moment its process is gone.
//
// **The budget is what the machine has free, in cores and in memory.** The
// core count stays the ceiling, but load from outside the ledger is subtracted from it, and a claim
// waits while the memory its tool holds is not free — `machine-capacity.ts` reads both. A claim marks
// its marker admitted once it runs, so the reading's load is split into the ledger's and the rest.

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

// **The cores each heavy tool occupies, declared once for both places that reserve them**
// `gate-plan.ts`'s checks and the `josh` commands that run the same tools
// directly read these, so a direct `josh lint` claims what the gate's lint claims. The lint, type check
// and spell check numbers are `gate-plan.ts`'s measured table, floored. The whole-tree eslint scan
// behind `josh lines` and `josh refactor:scan` runs in one process: measured cold on the 11-core
// machine on 2026-10-06, 113s of CPU over 98s of wall, so it gets one core.
const CORE_WEIGHTS = {
	lint: 2,
	type_check: 1,
	spell_check: 1,
	eslint_scan: 1,
} as const

// **The memory each heavy tool holds, declared beside its cores**: peak
// resident size in MB, rounded up. Measured with `/usr/bin/time -l` on the 11-core / 18 GB machine on
// 2026-10-07: the type check 1,244 MB, the spell check 330 MB, and one unit worker 319 MB over 54 test
// files. Typed eslint was 1,207 MB over one directory and was observed at 1.6–2.4 GB per whole-tree
// `eslint .` with three lanes running the same day, so lint and the whole-tree scan take that peak.
const MEMORY_MB = {
	lint: 2400,
	type_check: 1300,
	spell_check: 350,
	eslint_scan: 2400,
	unit_worker: 350,
} as const

// **The environment mark that says a parent already holds this process's cores**
// `josh gate` reserves per check and then spawns `pnpm josh lint`. Without
// the mark, that child's own dispatch would claim a second place for the cores its parent already
// holds. Every holder sets it, and every child inherits it through the environment and claims nothing.
const HELD_KEY = 'JOSH_CORE_RESERVED'
const HELD_VALUE = '1'

// `memory_mb` and `admitted_at` are optional so a marker an older `josh` wrote still reads: it holds no
// declared memory, and it counts as load from outside the ledger until it is gone.
const reservation_schema = process_owner_schema.extend({
	weight: z.number(),
	claimed_at: z.number(),
	memory_mb: z.number().optional(),
	admitted_at: z.number().optional(),
})

type Reservation = z.infer<typeof reservation_schema>

type ReservationFields = Pick<Reservation, 'weight' | 'claimed_at' | 'memory_mb' | 'admitted_at'>

interface LiveReservation extends LedgerEntry {
	reservation: Reservation
}

interface ReserveOptions {
	budget?: number
	memory_mb?: number | undefined
	read_machine?: () => Promise<MachineReading>
	wait_cap_ms?: number
	poll_interval_ms?: number
	directory?: string
	now?: () => number
	sleep?: (ms: number) => Promise<void>
}

interface Handle {
	target: string
	admission: Admission
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

	return json_value.parse_with(raw, reservation_schema)
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
// stalls a run on a guess. The suffix leaves out `replace_stamp`'s in-flight temporary copy of a marker,
// which would otherwise count one place twice.
function marker_files(directory: string): Array<string> {
	try {
		return readdirSync(directory).filter(
			(name) => name.startsWith(RESERVED_PREFIX) && name.endsWith(RESERVED_SUFFIX),
		)
	} catch {
		return []
	}
}

function live_reservations(directory: string = PLATFORM_TEMP_ROOT): Array<LiveReservation> {
	return marker_files(directory).flatMap((name) => {
		const reservation = live_reservation(path.join(directory, name))

		return reservation === undefined ? [] : { key: name, reservation }
	})
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

// **Replaced atomically, never unlinked and recreated**: the admitted rewrite lands on a marker other
// lanes are polling, and a reader that hit the gap between an unlink and its create would see the ledger
// without this place and admit past it.
function write_reservation(target: string, fields: ReservationFields): void {
	stamp_file.replace_stamp(target, { ...process_identity.own_fields(), ...fields })
}

// The clock and cadence a wait runs on, resolved apart from the ledger fields so `reserve` stays under
// the complexity limit — each default is a branch.
interface TimingConfig {
	now: () => number
	sleep: (ms: number) => Promise<void>
	poll_interval_ms: number
	wait_cap_ms: number
}

interface WaitContext extends TimingConfig {
	read_machine: () => Promise<MachineReading>
	key: string
	target: string
	directory: string
	budget: number
	deadline: number
	fields: ReservationFields
}

function resolve_timing(options: ReserveOptions): TimingConfig {
	return {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? default_sleep,
		poll_interval_ms: options.poll_interval_ms ?? POLL_INTERVAL_MS,
		wait_cap_ms: options.wait_cap_ms ?? WAIT_CAP_MS,
	}
}

// **A claim alone in the ledger reads nothing from the machine**: the head is admitted whatever the
// budget says, so a solo run pays no sampling window and starts exactly as it did before.
async function current_budget(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
): Promise<MachineBudget> {
	if (reservations.length <= 1) return { cores: context.budget, memory_mb: Infinity }

	const reading = await context.read_machine()
	const ledger = core_admission.ledger_load(reservations, context.now())
	const budget = machine_capacity.machine_budget(context.budget, reading, ledger)

	return { ...budget, cores: normalize_budget(budget.cores) }
}

// The claim is admitted: its marker records when, which moves its load from "load outside the ledger"
// to "load the ledger holds" for every later reader — its cores at once, its memory once its tool has
// had time to ramp up.
function admit(context: WaitContext, overflow?: Overflow): Admission {
	write_reservation(context.target, { ...context.fields, admitted_at: context.now() })

	return { overflow }
}

function overflow_of(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
	budget: MachineBudget,
): Overflow {
	return {
		waited_ms: context.now() - context.fields.claimed_at,
		ledger: core_admission.sum_load(reservations),
		budget,
	}
}

async function poll_admission(context: WaitContext): Promise<Admission | undefined> {
	const reservations = live_reservations(context.directory)
	const budget = await current_budget(context, reservations)

	if (core_admission.is_admitted(context.key, reservations, budget)) return admit(context)

	if (context.now() >= context.deadline) {
		return admit(context, overflow_of(context, reservations, budget))
	}

	return undefined
}

// Poll the ledger until this reservation is admitted, or until the wait cap admits it at minimum width.
// A solo run is admitted on the first read — its own claim is the ledger's head — so the loop body never
// runs and the wait costs nothing.
async function await_admission(context: WaitContext): Promise<Admission> {
	let admission = await poll_admission(context)

	while (admission === undefined) {
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		await context.sleep(context.poll_interval_ms)
		// eslint-disable-next-line no-await-in-loop -- polling: each read waits on the state the previous one saw
		admission = await poll_admission(context)
	}

	return admission
}

async function reserve(weight: number, options: ReserveOptions = {}): Promise<Handle> {
	const timing = resolve_timing(options)
	const directory = options.directory ?? PLATFORM_TEMP_ROOT
	const claimed_at = timing.now()
	const name = marker_name(randomUUID())
	const target = path.join(directory, name)
	const fields = { weight, claimed_at, memory_mb: options.memory_mb }

	write_reservation(target, fields)
	const admission = await await_admission({
		...timing,
		key: name,
		target,
		directory,
		budget: normalize_budget(options.budget ?? availableParallelism()),
		deadline: claimed_at + timing.wait_cap_ms,
		fields,
		read_machine: options.read_machine ?? machine_capacity.read_machine,
	})

	return { target, admission }
}

function release(handle: Handle): void {
	sweep_marker(handle.target)
}

// The whole reservation lifetime around a step: claim a place, wait for admission, run, and free the
// place on any exit. `finally`, so a step that threw still releases its cores. The step is told how it was
// admitted, so the gate can report one that started past the budget.
async function with_core_reservation<T>(
	weight: number,
	run: (admission: Admission) => Promise<T>,
	options: ReserveOptions = {},
): Promise<T> {
	const handle = await reserve(weight, options)

	try {
		return await run(handle.admission)
	} finally {
		release(handle)
	}
}

function is_held(): boolean {
	return process.env[HELD_KEY] === HELD_VALUE
}

// A function of its own so the restoring write does not sit after an `await`, where
// `require-atomic-updates` reads any write to `process` as a possible race — the reason `josh.ts`
// gives `record_exit_code`.
function set_held_mark(value: string): void {
	process.env[HELD_KEY] = value
}

// Marks this process, and every child it spawns, as running inside a held reservation. The previous
// value comes back afterwards, so a nested holder never clears the mark its outer holder set.
async function with_held_mark<T>(run: () => Promise<T>): Promise<T> {
	const previous = process.env[HELD_KEY] ?? ''

	set_held_mark(HELD_VALUE)

	try {
		return await run()
	} finally {
		set_held_mark(previous)
	}
}

// **A command's reservation: the gate's claim, unless a parent already holds the cores**
// `josh-logic.ts` calls this around every command that declares a weight.
// Each command then only declares its weight, and no command carries a copy of the claim, run and
// release steps. A solo run is admitted on the first read, so a run with room on the machine starts
// with no wait. A command inside a unit suite claims nothing either, for the reason `reserved-run.ts`
// gives: the suite's own reservation already covers it, and a place claimed there would wait on it.
async function with_command_reservation<T>(
	weight: number,
	run: () => Promise<T>,
	options: ReserveOptions = {},
): Promise<T> {
	if (is_held() || unit_worker_share.is_nested_run()) return await run()

	return await with_core_reservation(weight, async () => await with_held_mark(run), options)
}

const core_budget = {
	CORE_WEIGHTS,
	HELD_KEY,
	HELD_VALUE,
	MEMORY_MB,
	RESERVED_PREFIX,
	admitted_keys: core_admission.admitted_keys,
	admitted_load: core_admission.admitted_load,
	describe_overflow: core_admission.describe_overflow,
	is_held,
	live_reservations,
	release,
	reserve,
	with_command_reservation,
	with_core_reservation,
	with_held_mark,
}

export type { LiveReservation, Reservation, ReserveOptions }
export { core_budget }

export { type Admission } from './core-admission'
