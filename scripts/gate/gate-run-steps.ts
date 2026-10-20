import { availableParallelism } from 'node:os'
import { bounded_pool } from '#scripts/lib/bounded-pool'
import { buffered_process } from '#scripts/lib/buffered-process'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { core_budget } from './core-budget'
import { gate_plan, type GatePlan } from './gate-plan'
import type { GateStep, GateStepResult } from './gate-report'
import { build_gate_step, with_granted_workers } from './gate-steps'
import { project_checks } from './project-checks'

// Running the gate's checks: each one under its place in the machine-wide budget, a reused one
// (`check-reuse.ts`) without starting it. `verification-gate.ts` decides what runs and records the
// outcome; this module only runs it.

async function run_gate_step(step: GateStep): Promise<GateStepResult> {
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

	return { label: step.label, command: step.command_args.join(' '), ...result }
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
	memory_mb: number
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
			memory_mb: gate_plan.check_memory(check, plan, available_cores),
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

// **A nested gate takes no reservation, and the budget is what makes that necessary rather than
// merely tidy**. The unit step spawns the suite, which runs this repository's
// own gate tests; each of those is a gate inside the outer gate's unit reservation, and a place it
// claimed would wait for cores the outer gate cannot free until the suite — this test included —
// finishes.
async function run_reserved_step(
	reserved: ReservedStep,
	budget: BudgetContext,
): Promise<GateStepResult> {
	if (reserved.reused_at !== undefined) return reused_result(reserved.step, reserved.reused_at)
	if (!budget.is_reserved) return await run_gate_step(reserved.step)

	return await core_budget.with_core_reservation(
		reserved.weight,
		async (admission) => ({
			...(await run_gate_step(with_granted_workers(reserved.step, admission.granted))),
			budget_note: core_budget.describe_overflow(admission),
		}),
		{
			budget: budget.available_cores,
			memory_mb: reserved.memory_mb,
			command: `gate ${reserved.step.label}`,
			is_unit: reserved.step.label === gate_plan.UNIT_LABEL,
		},
	)
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

	// **The checks run under the held mark, so a check's own dispatch claims nothing**.
	// Each check is a `pnpm josh <target>` child, and a target that declares
	// a weight would otherwise claim a second place for the cores reserved for it here. A nested gate
	// sets the mark too, since its checks are covered by the outer gate's reservation.
	return await core_budget.with_held_mark(
		async () =>
			await bounded_pool.bounded_map(
				reserved,
				plan.concurrency,
				async (entry) => await run_reserved_step(entry, budget),
			),
	)
}

const gate_run_steps = { default_budget, run_gate_step, run_gate_steps }

export type { BudgetContext, ReusedChecks }
export { gate_run_steps }
