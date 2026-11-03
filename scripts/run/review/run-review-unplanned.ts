import type { Clash } from '#scripts/backlog/backlog-overlap'
import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_plan, type LanePlan } from '#scripts/lane/lane-plan'
import { lane_plan_probe, type Extended } from '#scripts/lane/lane-plan-probe'
import { lane_plan_wait_until } from '#scripts/lane/lane-plan-wait-until'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import type { Unplanned } from '#scripts/run/ship/run-ship-planned'

// **`run:review`'s open asks `lane:plan` for the files its record never listed** (joshuafolkken/kit#6142):
// met first at the ship's preflight, an unplanned file's overlap left the lane nothing to do but wait on
// its holder. The open widens the plan when no running lane holds those files, and stops on a holder
// while dropping the file is still an option. An unread listing writes nothing and does not stop; the
// ship's `unplanned` preflight still checks every case.

// The wait `lane:plan` would keep on the holder, read off the same deadline it enforces
// (joshuafolkken/kit#6145): a lane that could only wait learns how long, and that spilling the file is
// the other way out. With no deadline the re-run yields the seat, so spilling is the only way out.
async function ways_out(widened: LanePlan, clash: Clash, files: string): Promise<string> {
	const issue = String(widened.issue)
	const spill = `drop the change to ${files} and spill it with \`pnpm josh issue:spill ${issue} --estimate "<files> ファイル / <lines> 行"\``
	const until = await lane_plan_wait_until.until(widened, clash.holder)
	const holder = session_cite.issue(clash.holder)

	if (until === undefined) return `\`lane:plan\` would yield to ${holder}, not wait: ${spill}`
	const minutes = Math.ceil((Date.parse(until) - Date.now()) / MS_PER_MINUTE)
	const replan = ['pnpm josh lane:plan', issue, ...widened.paths].join(' ')

	return `\`lane:plan\` waits on ${holder} at most ${String(minutes)} min (until ${until}): ${spill}, or run \`${replan}\` to wait`
}

async function answer(
	found: Unplanned,
	widened: LanePlan,
	extended: Extended,
): Promise<string | undefined> {
	if (lane_plan_probe.is_oversize(extended)) {
		return `${session_cite.issue(found.issue)}'s plan widened by ${found.files.join(', ')} outgrows the Issue's declared size: run \`lane:plan\` (it answers \`split\`). ${found.text}`
	}

	if (lane_plan_probe.is_unread(extended)) return undefined

	if (extended !== undefined) {
		const ways = await ways_out(widened, extended, found.files.join(', '))

		return `${lane_plan_probe.overlap_text(found.issue, extended)}. ${ways}. ${found.text}`
	}

	console.info(
		`lane:plan widened by ${found.files.join(', ')}: no running lane holds them; comment the reason for the widening on the Issue in one line`,
	)

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

	return await answer(found, widened, await lane_plan_probe.extend(widened, directory))
}

const run_review_unplanned = { refusal }

export { run_review_unplanned }
