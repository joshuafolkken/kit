import { core_budget } from '#scripts/gate/core-budget'
import { lane_launch_admission } from './lane-launch-admission'
import type { LaunchContext, LaunchOutcome } from './lane-launch-cli'

type Claim = ReturnType<typeof core_budget.claim>
// One waiting claim per issue: the driver launches a pass's lanes side by side
// (joshuafolkken/kit#5519), so one issue's claim must not release another's.
const pending = new Map<string, Claim>()

function keep(issues: ReadonlyArray<string>): void {
	for (const [issue, claim] of pending) {
		if (issues.includes(issue)) continue

		core_budget.release(claim)
		pending.delete(issue)
	}
}

function claim_for(issue: string): Claim {
	const claim = pending.get(issue) ?? core_budget.claim(0, lane_launch_admission.options_of(issue))

	pending.set(issue, claim)

	return claim
}

// A wait is not a failed launch or a running child: the driver keeps collecting children and
// checking its window. Only a later offered pass with room may actually open and dispatch.
async function launch(
	context: LaunchContext,
	run: (context: LaunchContext) => Promise<LaunchOutcome>,
): Promise<LaunchOutcome> {
	const handle = await core_budget.poll_claim(claim_for(context.issue))

	if (handle === undefined) return { kind: 'waiting' }

	pending.delete(context.issue)

	return await lane_launch_admission.run_reserved(context, run, handle)
}

const lane_launch_pending = { keep, launch }

export { lane_launch_pending }
