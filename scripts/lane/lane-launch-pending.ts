import { core_budget } from '#scripts/gate/core-budget'
import { lane_launch_admission } from './lane-launch-admission'
import type { LaunchContext, LaunchOutcome } from './lane-launch-cli'

type Claim = ReturnType<typeof core_budget.claim>
const pending: { value: { issue: string; claim: Claim } | undefined } = { value: undefined }

function keep(issues: ReadonlyArray<string>): void {
	if (pending.value === undefined || issues.includes(pending.value.issue)) return

	core_budget.release(pending.value.claim)
	pending.value = undefined
}

function claim_for(issue: string): Claim {
	keep([issue])
	pending.value ??= { issue, claim: core_budget.claim(0, lane_launch_admission.options_of(issue)) }

	return pending.value.claim
}

// A wait is not a failed launch or a running child: the driver keeps collecting children and
// checking its window. Only a later offered pass with room may actually open and dispatch.
async function launch(
	context: LaunchContext,
	run: (context: LaunchContext) => Promise<LaunchOutcome>,
): Promise<LaunchOutcome> {
	const handle = await core_budget.poll_claim(claim_for(context.issue))

	if (handle === undefined) return { kind: 'waiting' }

	pending.value = undefined

	return await lane_launch_admission.run_reserved(context, run, handle)
}

const lane_launch_pending = { keep, launch }

export { lane_launch_pending }
