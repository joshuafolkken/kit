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
import { busy_average, type BusySample } from './busy-average'
import { core_admission, type Admission, type LedgerEntry, type Overflow } from './core-admission'
import { core_wait, type BudgetWait, type WaitReason } from './core-wait'
import { core_wait_record, type WaitSink } from './core-wait-record'
import { core_weights } from './core-weights'
import { held_mark } from './held-mark'
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
// `reserved(2 + 2 + 2) + unit_cap(cores - 6)` is exactly `cores` — so a single gate's four claims sum
// to the whole budget and, while the busy cores stay within what the ledger holds, every one is
// admitted the instant it is made, with no poll and no wait. Under
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
// The head of an unsaturated ledger is always admitted, so the smallest declared budget is one core.
const MIN_BUDGET = 1

// `memory_mb` and `admitted_at` are optional so a marker an older `josh` wrote still reads: it holds no
// declared memory, and it counts as load from outside the ledger until it is gone.
// `command`, `checkout`, `lane`, `lanes_root` and `wait_reason` name a waiting claim on `run:board`
// (`core-wait.ts`). `is_unit` marks a unit suite's claim, which may be admitted narrowed to `granted`
// past the wait cap (`core_admission.narrowed_weight`).
const reservation_schema = process_owner_schema.extend({
	weight: z.number(),
	claimed_at: z.number(),
	memory_mb: z.number().optional(),
	admitted_at: z.number().optional(),
	is_unit: z.boolean().optional(),
	granted: z.number().optional(),
	command: z.string().optional(),
	checkout: z.string().optional(),
	lane: z.string().optional(),
	lanes_root: z.string().optional(),
	wait_reason: z.enum(core_wait.WAIT_REASONS).optional(),
})

type Reservation = z.infer<typeof reservation_schema>

type ReservationFields = Omit<Reservation, 'pid' | 'process_start'>

interface LiveReservation extends LedgerEntry {
	reservation: Reservation
}

interface ReserveOptions {
	budget?: number
	memory_mb?: number | undefined
	// What the claim is for, named on the waiting line and on `run:board`.
	command?: string | undefined
	// A unit suite's claim, whose weight is its worker count.
	is_unit?: boolean | undefined
	report?: (line: string) => void
	read_machine?: () => Promise<MachineReading>
	wait_cap_ms?: number
	poll_interval_ms?: number
	directory?: string
	now?: () => number
	sleep?: (ms: number) => Promise<void>
	// Where a claim that waited records how long, once admitted (`core-wait-record.ts`).
	record_wait?: WaitSink
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

function report_wait(line: string): void {
	process.stderr.write(`${line}\n`)
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
	report: (line: string) => void
	record_wait: WaitSink | undefined
	key: string
	target: string
	directory: string
	budget: number
	deadline: number
	fields: ReservationFields
	busy_samples: Array<BusySample>
}

function resolve_timing(options: ReserveOptions): TimingConfig {
	return {
		now: options.now ?? Date.now,
		sleep: options.sleep ?? default_sleep,
		poll_interval_ms: options.poll_interval_ms ?? POLL_INTERVAL_MS,
		wait_cap_ms: options.wait_cap_ms ?? WAIT_CAP_MS,
	}
}

// **A claim alone in the ledger reads the machine too** (joshuafolkken/kit#4238): load outside the
// ledger saturates the CPU whether or not another claim is in it. The busy cores are the mean of this
// wait's recent readings of load outside the ledger (`busy-average.ts`). That load holds every claim but
// the first waiter, which it narrows instead (`core_admission.is_admitted`, joshuafolkken/kit#4313) unless
// the run queue reads the machine overloaded (`machine_capacity.machine_budget`, joshuafolkken/kit#4361).
async function current_budget(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
): Promise<MachineBudget> {
	const reading = await context.read_machine()
	const ledger = core_admission.ledger_load(reservations, context.now())

	context.busy_samples = busy_average.with_reading(
		context.busy_samples,
		reading,
		ledger.cores,
		context.now(),
	)

	const mean = busy_average.averaged(reading, context.busy_samples, ledger.cores)

	return machine_capacity.machine_budget(context.budget, mean, ledger)
}

// The claim is admitted: its marker records when, which moves its load from "load outside the ledger"
// to "load the ledger holds" for every later reader — its cores at once, its memory once its tool has
// had time to ramp up.
function admit(context: WaitContext, overflow?: Overflow, granted?: number): Admission {
	write_reservation(context.target, { ...context.fields, admitted_at: context.now(), granted })

	return { overflow, granted }
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

// The marker records why the claim waits, rewritten only when the reason changes, and the command says
// so once, when its wait starts.
function mark_waiting(context: WaitContext, reason: WaitReason): void {
	const previous = context.fields.wait_reason

	if (previous === reason) return

	context.fields = { ...context.fields, wait_reason: reason }
	write_reservation(context.target, context.fields)

	if (previous === undefined) context.report(core_wait.wait_line(context.fields.command, reason))
}

async function poll_admission(context: WaitContext): Promise<Admission | undefined> {
	const reservations = live_reservations(context.directory)
	const budget = await current_budget(context, reservations)
	// A unit claim is admitted at the room the budget leaves rather than at full width — the first
	// waiter, which load outside the ledger does not hold, as well as one past the wait cap.
	const granted = core_admission.narrowed_weight(context.key, reservations, budget.cores)
	const reason = core_wait.hold_reason(context.key, reservations, budget, granted)

	if (reason === undefined) return admit(context, undefined, granted)

	if (context.now() >= context.deadline) {
		const held = core_admission.with_grant(context.key, reservations, granted)

		return admit(context, overflow_of(context, held, budget), granted)
	}

	mark_waiting(context, reason)

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

	await core_wait_record.record_admitted(context.fields, context.now(), context.record_wait)

	return admission
}

// What a wait reads the machine through, reports its start to and records its length in.
function resolve_ports(
	options: ReserveOptions,
): Pick<WaitContext, 'read_machine' | 'report' | 'record_wait'> {
	return {
		read_machine: options.read_machine ?? machine_capacity.read_machine,
		report: options.report ?? report_wait,
		record_wait: options.record_wait,
	}
}

// The checkout the claim runs in, so `run:board` can say whose claim waits. The ledger is the
// machine's, so the checkout may be another repository's (`core-wait.ts` → `where_of`).
function claim_fields(
	weight: number,
	claimed_at: number,
	options: ReserveOptions,
): ReservationFields {
	const { memory_mb, command, is_unit } = options

	return { weight, claimed_at, memory_mb, command, is_unit, ...core_wait.where_of(process.cwd()) }
}

async function reserve(weight: number, options: ReserveOptions = {}): Promise<Handle> {
	const timing = resolve_timing(options)
	const directory = options.directory ?? PLATFORM_TEMP_ROOT
	const claimed_at = timing.now()
	const name = marker_name(randomUUID())
	const target = path.join(directory, name)
	const fields = claim_fields(weight, claimed_at, options)

	write_reservation(target, fields)
	const admission = await await_admission({
		...timing,
		key: name,
		target,
		directory,
		budget: normalize_budget(options.budget ?? availableParallelism()),
		deadline: claimed_at + timing.wait_cap_ms,
		fields,
		busy_samples: [],
		...resolve_ports(options),
	})

	return { target, admission }
}

// The claims waiting in the ledger now, for a `run:board` running in `home`.
function budget_waits(
	directory: string = PLATFORM_TEMP_ROOT,
	now: number = Date.now(),
	home: string = process.cwd(),
): Array<BudgetWait> {
	return core_wait.waits_of(live_reservations(directory), now, home)
}

function release(handle: Handle): void {
	sweep_marker(handle.target)
}

// The whole reservation lifetime around a step: claim a place, wait for admission, run, and free the
// place on any exit. `finally`, so a step that threw still releases its cores. The step is told how it was
// admitted, so the gate can report one that started past the budget, and the claim's ledger key.
async function with_core_reservation<T>(
	weight: number,
	run: (admission: Admission, key: string) => Promise<T>,
	options: ReserveOptions = {},
): Promise<T> {
	const handle = await reserve(weight, options)

	try {
		return await run(handle.admission, path.basename(handle.target))
	} finally {
		release(handle)
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
	if (held_mark.is_held() || unit_worker_share.is_nested_run()) return await run()

	return await with_core_reservation(
		weight,
		async (_admission, key) => await held_mark.with_held_mark(run, key),
		options,
	)
}

// The unit claim the parent command holds for this process (`with_command_reservation`), or
// `undefined` where none does. A held claim that is not a unit suite's says nothing about workers.
function held_unit_claim(directory: string = PLATFORM_TEMP_ROOT): Reservation | undefined {
	const key = held_mark.held_reservation()

	if (key === undefined) return undefined

	const held = live_reservations(directory).find((entry) => entry.key === key)

	return held?.reservation.is_unit === true ? held.reservation : undefined
}

const core_budget = {
	CORE_WEIGHTS: core_weights.CORE_WEIGHTS,
	HELD_KEY: held_mark.HELD_KEY,
	HELD_VALUE: held_mark.HELD_VALUE,
	MEMORY_MB: core_weights.MEMORY_MB,
	RESERVED_PREFIX,
	admitted_keys: core_admission.admitted_keys,
	admitted_load: core_admission.admitted_load,
	budget_waits,
	describe_overflow: core_admission.describe_overflow,
	held_unit_claim,
	is_held: held_mark.is_held,
	live_reservations,
	release,
	reserve,
	with_command_reservation,
	with_core_reservation,
	with_held_mark: held_mark.with_held_mark,
}

export type { LiveReservation, Reservation, ReserveOptions }
export { core_budget }

export { type Admission } from './core-admission'
