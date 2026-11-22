import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import { check_related_unplanned } from '#scripts/gate/check-related-unplanned'
import { changed_paths } from '#scripts/git/changed-paths'
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

// Where the clean widening's line goes: the console for `run:review`, the edit hook's context for
// `unplanned-edit.ts`, whose stdout carries one JSON envelope and nothing else.
type Inform = (line: string) => void

async function answer(
	found: Unplanned,
	widened: LanePlan,
	extended: Extended,
	inform: Inform,
): Promise<string | undefined> {
	if (lane_plan_probe.is_oversize(extended)) {
		return `${session_cite.issue(found.issue)}'s plan widened by ${found.files.join(', ')} outgrows the Issue's declared size: run \`lane:plan\` (it answers \`split\`). ${found.text}`
	}

	if (lane_plan_probe.is_unread(extended)) return undefined

	if (extended !== undefined) {
		const ways = await ways_out(widened, extended, found.files.join(', '))

		return `${lane_plan_probe.overlap_text(found.issue, extended)}. ${ways}. ${found.text}`
	}

	inform(
		`lane:plan widened by ${found.files.join(', ')}: no running lane holds them; comment the reason for the widening on the Issue in one line`,
	)

	return undefined
}

// A directory or glob claim stays only while one of the lane's actual changes sits inside it
// (joshuafolkken/kit#8662): a directory the plan comment's prose named but the lane never touched would
// otherwise hold every new file under it against other Issues. A later edit there is unplanned again,
// and the next widening restores the claim. `changed` undefined keeps every claim.
function narrowed(
	paths: ReadonlyArray<string>,
	changed: ReadonlyArray<string> | undefined,
): Array<string> {
	if (changed === undefined) return [...paths]

	return paths.filter(
		(path) =>
			backlog_overlap.is_file_claim(path) ||
			changed.some((file) => backlog_overlap.claims_meet(path, file)),
	)
}

function widened_of(
	found: Unplanned,
	changed: ReadonlyArray<string> | undefined,
	directory: string,
): LanePlan | undefined {
	const recorded = lane_plan.read(found.issue, directory)

	return recorded === undefined
		? undefined
		: {
				...recorded,
				paths: [...narrowed(recorded.paths, changed), ...found.files],
				widened_paths: [...(recorded.widened_paths ?? []), ...found.files],
			}
}

// Only `run:review`'s open narrows: the lane's changes are complete by then. The edit hook's widening
// runs mid-lane, before the lane reached every directory it planned, so it keeps them all.
async function changes_of(
	found: Unplanned | undefined,
	is_narrowing: boolean,
): Promise<ReadonlyArray<string> | undefined> {
	if (found === undefined || !is_narrowing) return undefined

	return [...(await changed_paths.read_changed_paths(false)), ...found.files]
}

async function refusal_to(
	directory: string,
	inform: Inform,
	is_narrowing = false,
): Promise<string | undefined> {
	const found = await check_related_unplanned.read_unplanned()
	const changed = await changes_of(found, is_narrowing)
	const widened = found === undefined ? undefined : widened_of(found, changed, directory)

	if (found === undefined || widened === undefined) return undefined

	return await answer(found, widened, await lane_plan_probe.extend(widened, directory), inform)
}

async function refusal(directory: string = process.cwd()): Promise<string | undefined> {
	return await refusal_to(directory, console.info, true)
}

const run_review_unplanned = { refusal, refusal_to }

export { run_review_unplanned }
export type { Inform }
