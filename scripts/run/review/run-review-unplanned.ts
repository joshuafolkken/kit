import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { lane_plan, type LanePlan } from '#scripts/lane/lane-plan'
import { lane_plan_probe, type Probe } from '#scripts/lane/lane-plan-probe'
import type { Unplanned } from '#scripts/run/ship/run-ship-planned'

// **`run:review`'s open asks `lane:plan` for the files its record never listed** (joshuafolkken/kit#6142):
// met first at the ship's preflight, an unplanned file's overlap left the lane nothing to do but wait on
// its holder. The open widens the plan when no running lane holds those files, and stops on a holder
// while dropping the file is still an option. An unread listing writes nothing and does not stop; the
// ship's `unplanned` preflight still checks every case.

function answer(found: Unplanned, extended: Probe): string | undefined {
	if (lane_plan_probe.is_unread(extended)) return undefined

	if (extended !== undefined) {
		return `${lane_plan_probe.overlap_text(found.issue, extended)}. ${found.text}`
	}

	console.info(`lane:plan widened by ${found.files.join(', ')}: no running lane holds them`)

	return undefined
}

function widened_of(found: Unplanned, directory: string): LanePlan | undefined {
	const recorded = lane_plan.read(found.issue, directory)

	return recorded === undefined
		? undefined
		: { ...recorded, paths: [...recorded.paths, ...found.files] }
}

async function refusal(directory: string = process.cwd()): Promise<string | undefined> {
	const found = await check_related_unplanned.read_unplanned()
	const widened = found === undefined ? undefined : widened_of(found, directory)

	if (found === undefined || widened === undefined) return undefined

	return answer(found, await lane_plan_probe.extend(widened, directory))
}

const run_review_unplanned = { refusal }

export { run_review_unplanned }
