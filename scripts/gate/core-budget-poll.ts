import { busy_average } from './busy-average'
import { core_admission, type Admission, type Overflow } from './core-admission'
import type { LiveReservation, WaitContext } from './core-budget'
import { core_reservation } from './core-reservation'
import { core_wait, type WaitReason } from './core-wait'
import { machine_capacity, type MachineBudget, type MachineReading } from './machine-capacity'

function check_measurement(command: string, reading: MachineReading): void {
	if (reading.memory_supported === true && !Number.isFinite(reading.available_mb)) {
		throw new Error(`${command}: memory measurement failed; admission refused`)
	}
}

function check_capacity(command: string, requested: number, total_mb: number | undefined): void {
	if (total_mb === undefined) return

	if (requested > total_mb) {
		throw new Error(
			`${command}: requested ${String(requested)} MB exceeds physical memory ${String(total_mb)} MB`,
		)
	}
}

function check_memory(context: WaitContext, reading: MachineReading): void {
	const requested = context.fields.memory_mb ?? 0

	if (requested === 0) return
	const command = context.fields.command ?? 'a step'
	const minimum =
		context.fields.is_unit === true ? requested / Math.max(1, context.fields.weight) : requested

	check_measurement(command, reading)
	check_capacity(command, minimum, reading.total_mb)
}

async function current_reading(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
): Promise<{ budget: MachineBudget; reading: MachineReading }> {
	const reading = await context.read_machine()
	const ledger = core_admission.ledger_load(reservations, context.now())

	check_memory(context, reading)
	context.busy_samples = busy_average.with_reading(
		context.busy_samples,
		reading,
		ledger.cores,
		context.now(),
	)
	const mean = busy_average.averaged(reading, context.busy_samples, ledger.cores)

	context.ease = busy_average.with_ease(context.ease, mean.busy_cores, context.now())

	return { budget: machine_capacity.machine_budget(context.budget, mean, ledger), reading }
}

interface Decision {
	budget: MachineBudget
	reading: MachineReading
	granted: number | undefined
	overflow?: Overflow | undefined
	reason: string
}

function admit(context: WaitContext, decision: Decision): Admission {
	const admitted_at = context.now()
	const { granted, overflow, reason, budget, reading } = decision

	core_reservation.write_reservation(context.target, { ...context.fields, admitted_at, granted })

	return {
		overflow,
		granted,
		waited_ms: admitted_at - context.fields.claimed_at,
		decision: { reason, budget, reading },
	}
}

function mark_waiting(context: WaitContext, reason: WaitReason): void {
	const previous = context.fields.wait_reason

	if (previous === reason) return
	context.fields = { ...context.fields, wait_reason: reason }
	core_reservation.write_reservation(context.target, context.fields)
	if (previous === undefined) context.report(core_wait.wait_line(context.fields.command, reason))
}

function spent_reason(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
	budget: MachineBudget,
): string | undefined {
	const now = context.now()

	if (now >= context.deadline) return 'cpu-deadline'
	const busy_cores = busy_average.mean_busy(context.busy_samples)
	const room = { busy_cores, cores: context.budget, now }

	return busy_average.is_unrelieved(context.ease, now, context.ease_window_ms) &&
		core_wait.is_held_in_vain(context.key, reservations, budget, room)
		? 'cpu-unrelieved'
		: undefined
}

function overflow_reason(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
	budget: MachineBudget,
): string | undefined {
	if (
		context.fields.is_strict_admission === true ||
		core_admission.is_memory_held(context.key, reservations, budget)
	) {
		return undefined
	}

	return spent_reason(context, reservations, budget)
}

function overflow_of(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
	decision: Decision,
): Admission {
	const held = core_admission.with_grant(context.key, reservations, decision.granted)
	const overflow = {
		waited_ms: context.now() - context.fields.claimed_at,
		ledger: core_admission.sum_load(held),
		budget: decision.budget,
	}

	return admit(context, { ...decision, overflow })
}

function fit_reason(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
	budget: MachineBudget,
): string {
	const requested = context.fields.memory_mb ?? 0

	if (context.fields.is_unit === true && requested > budget.memory_mb) {
		return 'unit-memory-narrowing'
	}

	const strict = { ...budget, busy_excess: 0, is_overloaded: true }

	return core_admission.is_admitted(context.key, reservations, strict)
		? 'budget-fit'
		: 'cpu-first-waiter'
}

async function poll_admission(
	context: WaitContext,
	reservations: ReadonlyArray<LiveReservation>,
): Promise<Admission | undefined> {
	const { budget, reading } = await current_reading(context, reservations)
	const granted = core_admission.narrowed_weight(context.key, reservations, budget.cores)
	const reason = core_wait.hold_reason(context.key, reservations, budget, granted)

	if (reason === undefined) {
		return admit(context, {
			budget,
			reading,
			granted,
			reason: fit_reason(context, reservations, budget),
		})
	}

	const overflow = overflow_reason(context, reservations, budget)

	if (overflow !== undefined) {
		return overflow_of(context, reservations, { budget, reading, granted, reason: overflow })
	}

	mark_waiting(context, reason)

	return undefined
}

const core_budget_poll = { poll_admission }

export { core_budget_poll }
