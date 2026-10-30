import { core_budget, type Handle, type ReserveOptions } from '#scripts/gate/core-budget'
import { core_wait } from '#scripts/gate/core-wait'
import type { LaunchContext, LaunchOutcome } from './lane-launch-cli'
import { lane_paths } from './lane-paths'

// Admission uses the per-process RSS median so an aggregate does not overcharge each new lane
// (joshuafolkken/kit#5409).
const LANE_MEMORY_MB = 270

function checkout_of(issue: string): string {
	const cwd = process.cwd()
	const root = core_wait.where_of(cwd).lanes_root ?? lane_paths.lane_root(cwd)

	return lane_paths.lane_directory(root, issue)
}

function options_of(issue: string): ReserveOptions {
	return {
		memory_mb: LANE_MEMORY_MB,
		is_strict_admission: true,
		is_memory_pending: true,
		command: 'lane:launch',
		checkout: checkout_of(issue),
	}
}

async function run_reserved(
	context: LaunchContext,
	run: (context: LaunchContext) => Promise<LaunchOutcome>,
	handle: Handle,
): Promise<LaunchOutcome> {
	let is_retained = false

	try {
		const outcome = await run(context)

		if (outcome.kind === 'launched') {
			core_budget.transfer(handle, Number(outcome.pid))
			is_retained = true
		}

		return outcome
	} finally {
		if (!is_retained) core_budget.release(handle)
	}
}

async function launch(
	context: LaunchContext,
	run: (context: LaunchContext) => Promise<LaunchOutcome>,
): Promise<LaunchOutcome> {
	const handle = await core_budget.reserve(0, options_of(context.issue))

	return await run_reserved(context, run, handle)
}

const lane_launch_admission = { launch, options_of, run_reserved }

export { lane_launch_admission }
