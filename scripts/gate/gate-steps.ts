import { gate_plan, type GateCheck, type GatePlan } from './gate-plan'
import type { GateStep } from './gate-report'
import { project_checks } from './project-checks'
import { type_check_step } from './type-check-step'

const JOSH = 'josh'
const { TYPE_CHECK_LABEL, UNIT_LABEL } = gate_plan
const UNIT_WORKER_FLAG = '--maxWorkers'

function unit_worker_args(check: GateCheck, plan: GatePlan): ReadonlyArray<string> {
	if (check.label !== UNIT_LABEL || plan.unit_worker_cap === undefined) return []

	return [`${UNIT_WORKER_FLAG}=${String(plan.unit_worker_cap)}`]
}

function check_args(check: GateCheck, plan: GatePlan): ReadonlyArray<string> {
	return [...(check.args ?? []), ...unit_worker_args(check, plan)]
}

// Resolve the type checker per project and run every static check from its package root.
async function build_gate_step(
	check: GateCheck,
	start_directory: string,
	plan: GatePlan = gate_plan.resolve_gate_plan(),
): Promise<GateStep> {
	const cwd = project_checks.is_basic(start_directory)
		? project_checks.project_root(start_directory)
		: undefined

	if (check.label !== TYPE_CHECK_LABEL) {
		return {
			label: check.label,
			command_args: [JOSH, check.target, ...check_args(check, plan)],
			cwd,
		}
	}

	const command_args = await type_check_step.resolve_type_check_args(start_directory)
	const skip_reason =
		command_args[0] === JOSH ? project_checks.type_check_skip_reason(start_directory) : undefined

	return { label: check.label, command_args, cwd, skip_reason }
}

async function build_gate_steps(
	start_directory: string,
	plan: GatePlan = gate_plan.resolve_gate_plan(),
): Promise<ReadonlyArray<GateStep>> {
	return await Promise.all(
		plan.checks.map(async (check) => await build_gate_step(check, start_directory, plan)),
	)
}

export { build_gate_step, build_gate_steps, UNIT_WORKER_FLAG }
