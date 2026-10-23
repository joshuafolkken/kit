import { availableParallelism } from 'node:os'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { buffered_process } from '#scripts/lib/buffered-process'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { check_cpu, type CheckCpu } from './check-cpu'
import { core_budget, type Admission } from './core-budget'
import { free_cores } from './free-cores'
import { gate_plan, type GatePlan } from './gate-plan'
import type { CheckClaim, GateStep, GateStepResult } from './gate-report'
import { build_gate_step, with_granted_workers } from './gate-steps'
import { project_checks } from './project-checks'

// Running the gate's checks: each one under its place in the machine-wide budget, a reused one
// (`check-reuse.ts`) without starting it. `verification-gate.ts` decides what runs and records the
// outcome; this module only runs it.

// `cpu` is the gate's shared reader, so concurrent checks each take their own growth; a lone call
// reads its child alone from a baseline of its own.
async function run_gate_step(
	step: GateStep,
	cpu: CheckCpu = check_cpu.check_cpu_reader(),
): Promise<GateStepResult> {
	if (step.skip_reason !== undefined) {
		return {
			label: step.label,
			command: step.command_args.join(' '),
			output: project_checks.skip_notice('check', step.skip_reason),
			exit_code: 0,
			elapsed_ms: 0,
		}
	}

	const result = await buffered_process.run_buffered_process(
		step.command_args,
		step.cwd === undefined ? {} : { cwd: step.cwd },
	)

	return { label: step.label, command: step.command_args.join(' '), ...result, cpu_ms: cpu() }
}

// This gate's share of the machine, resolved once at the gate's entry and carried down as one value.
// `available_cores` is the budget every check reserves against; `is_reserved`
// is false for a gate nested inside another gate's unit suite — this repository's own gate tests — so
// the outer gate reserves and every gate beneath it does not. Captured before this gate sets
// `JOSH_UNIT_RUN_MARKED`, which is why it is read at entry rather than re-derived here.
interface BudgetContext {
	available_cores: number
	is_reserved: boolean
}

function default_budget(): BudgetContext {
	return {
		available_cores: availableParallelism(),
		is_reserved: !unit_worker_share.is_nested_run() && !core_budget.is_held(),
	}
}

// A gate step paired with the cores it reserves from the machine-wide budget while it runs.
// The weight travels with the step so `run_gate_steps` never has to re-pair a
// step with its check by index.
interface ReservedStep {
	step: GateStep
	weight: number
	// The check's own `reserved_cores`, the key `gate_plan.lightest_first` orders the pool's queue by.
	reserved_cores: number
	memory_mb: number
	// The plan's `--maxWorkers` for the unit suite, the width the free memory bounds once it is admitted.
	worker_cap: number | undefined
	// When the check's own green record was taken, for a check `check-reuse.ts` found reusable.
	reused_at: string | undefined
}

// The checks this gate reuses, each mapped to when it was last green.
type ReusedChecks = ReadonlyMap<string, string>

async function build_reserved_steps(
	plan: GatePlan,
	available_cores: number,
	reused: ReusedChecks,
): Promise<ReadonlyArray<ReservedStep>> {
	return await Promise.all(
		plan.checks.map(async (check) => ({
			step: await build_gate_step(check, process.cwd(), plan),
			weight: gate_plan.check_weight(check, plan, available_cores),
			reserved_cores: check.reserved_cores,
			memory_mb: gate_plan.check_memory(check, plan, available_cores),
			worker_cap: plan.unit_worker_cap,
			reused_at: reused.get(check.label),
		})),
	)
}

// A reused check starts no process and claims no core: its result is the record's, and the empty
// output is what that record was written from (`gate_report.has_nothing_to_say`).
function reused_result(step: GateStep, reused_at: string): GateStepResult {
	return {
		label: step.label,
		command: step.command_args.join(' '),
		output: '',
		exit_code: 0,
		elapsed_ms: 0,
		reused_at,
	}
}

// What the check asked the budget for and what it ran at, for its ledger row (`gate-ledger.ts`).
function claim_of(requested: number, admission: Admission): CheckClaim {
	return {
		requested,
		granted: admission.granted ?? requested,
		waited_ms: admission.waited_ms ?? 0,
	}
}

// **The unit step's width is bounded by the free memory too** (joshuafolkken/kit#4528). The plan's cap
// and the granted width are sized from the cores alone, and the `--maxWorkers` they become skips the
// guard's own reading (`test-unit-guard.ts`), so the memory is read here, once the claim is admitted
// and the suite is about to start. The free cores are not applied: the admission has already narrowed
// the claim to them (joshuafolkken/kit#4167).
async function admitted_step(
	reserved: ReservedStep,
	admission: Admission,
	available_cores: number,
): Promise<GateStep> {
	if (reserved.step.label !== gate_plan.UNIT_LABEL) return reserved.step

	const { memory_workers } = await free_cores.read({ available_cores })
	const asked = admission.granted ?? reserved.worker_cap
	const workers = unit_worker_share.cap_to_free(asked, memory_workers, available_cores)

	return with_granted_workers(reserved.step, workers)
}

// **A nested gate takes no reservation, and the budget is what makes that necessary rather than
// merely tidy**. The unit step spawns the suite, which runs this repository's
// own gate tests; each of those is a gate inside the outer gate's unit reservation, and a place it
// claimed would wait for cores the outer gate cannot free until the suite — this test included —
// finishes.
async function run_reserved_step(
	reserved: ReservedStep,
	budget: BudgetContext,
	cpu: CheckCpu,
): Promise<GateStepResult> {
	if (reserved.reused_at !== undefined) return reused_result(reserved.step, reserved.reused_at)
	if (!budget.is_reserved) return await run_gate_step(reserved.step, cpu)

	return await core_budget.with_core_reservation(
		reserved.weight,
		async (admission) => ({
			...(await run_gate_step(
				await admitted_step(reserved, admission, budget.available_cores),
				cpu,
			)),
			budget_note: core_budget.describe_overflow(admission),
			claim: claim_of(reserved.weight, admission),
		}),
		{
			budget: budget.available_cores,
			memory_mb: reserved.memory_mb,
			command: `gate ${reserved.step.label}`,
			is_unit: reserved.step.label === gate_plan.UNIT_LABEL,
		},
	)
}

// The pool's queue in the order `resolve_concurrency` counted it (joshuafolkken/kit#4609), so the
// checks its width admitted are the ones that start, and one over the share waits for a slot rather
// than taking one ahead of a zero-weight check. Each result goes back to its check's declaration
// position, so the printed sections keep their order.
async function run_lightest_first(
	reserved: ReadonlyArray<ReservedStep>,
	concurrency: number,
	run: (entry: ReservedStep) => Promise<GateStepResult>,
): Promise<ReadonlyArray<GateStepResult>> {
	const indexed = reserved.map((entry, index) => ({ entry, index }))
	const queue = gate_plan.lightest_first(indexed, ({ entry }) => entry.reserved_cores)
	const finished = await bounded_pool.bounded_map(queue, concurrency, async ({ entry, index }) => ({
		index,
		result: await run(entry),
	}))

	return finished.toSorted((left, right) => left.index - right.index).map(({ result }) => result)
}

// `bounded_pool` rather than a bare `Promise.all`, so the plan's `concurrency` is what decides how
// many run at once. **The all-failures-in-one-pass property survives the
// change** because no check ever rejects: `buffered_process` reports a non-zero exit as a value, so
// the pool's first-failure abort — written for callers that spawn real Claude sessions — never
// fires here and every queued check still runs. Results come back in input order however they
// finished, which is what keeps the printed sections in declaration order. Each step first claims its
// place in the machine-wide budget and waits while the budget is full.
async function run_gate_steps(
	plan: GatePlan,
	budget: BudgetContext = default_budget(),
	reused: ReusedChecks = new Map(),
): Promise<ReadonlyArray<GateStepResult>> {
	const reserved = await build_reserved_steps(plan, budget.available_cores, reused)
	const cpu = check_cpu.check_cpu_reader()

	// **The checks run under the held mark, so a check's own dispatch claims nothing**.
	// Each check is a `pnpm josh <target>` child, and a target that declares
	// a weight would otherwise claim a second place for the cores reserved for it here. A nested gate
	// sets the mark too, since its checks are covered by the outer gate's reservation.
	return await core_budget.with_held_mark(
		async () =>
			await run_lightest_first(
				reserved,
				plan.concurrency,
				async (entry) => await run_reserved_step(entry, budget, cpu),
			),
	)
}

const gate_run_steps = { default_budget, run_gate_step, run_gate_steps }

export type { BudgetContext, ReusedChecks }
export { gate_run_steps }
