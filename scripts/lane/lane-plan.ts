import type { Declared } from '#scripts/backlog/backlog-overlap'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { durable_state } from '#scripts/josh/durable-state'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// The files a lane child plans to edit, recorded by `josh lane:plan` once its work summary settles.
//
// **An issue body names the paths its reporter saw, not the ones the change touches.**
// joshuafolkken/kit#4858 and joshuafolkken/kit#4859 declared disjoint paths, ran side by side, and both
// edited `scripts/lane/lane-overrun.ts`; the second ship stopped on the conflict (joshuafolkken/kit#4864).
// The plan is the first moment the touched files are known, so it is recorded here and read as a
// declaration beside the body — by `lane:plan` to hold the later lane back, and by `backlog:next` so a
// candidate waits on a running lane's plan as it waits on its body.
//
// **Keyed to the repository and the issue, not the work tree**, and kept in the common git directory
// (`durable-state.ts`): the lane records it from its own work tree and the parent reads it from the main
// checkout, both resolve the same directory, and a reboot does not drop a running lane's plan.
// `lane:close` releases it with the lane (`release`).

const lane_plan_schema = z.object({
	issue: z.number(),
	paths: z.array(z.string()),
	planned_at: z.string(),
	cleared: z.boolean().optional(),
})

type LanePlan = z.infer<typeof lane_plan_schema>

function plan_path(repository: string, issue: number): string {
	return durable_state.path(durable_state.PREFIX.LANE_PLAN, repository, `-${String(issue)}.json`)
}

function record(plan: LanePlan, directory: string): boolean {
	const repository = git_common_directory.repository(directory)

	if (repository === undefined) return false

	stamp_file.replace_stamp(plan_path(repository, plan.issue), plan)

	return true
}

function remove(issue: number, directory: string): void {
	const repository = git_common_directory.repository(directory)

	if (repository !== undefined) stamp_file.remove_stamp(plan_path(repository, issue))
}

function read(issue: number, directory: string): LanePlan | undefined {
	const repository = git_common_directory.repository(directory)
	const text =
		repository === undefined ? undefined : stamp_file.read_stamp_text(plan_path(repository, issue))

	return text === undefined ? undefined : json_value.parse_with(text, lane_plan_schema)
}

// Whether `issue` has no plan that `lane:plan` cleared, in a repository that can hold one — a checkout
// with no common git directory cannot record a plan, so it is never asked for one. A plan recorded and
// still waiting is not cleared: the record is written before the wait, so it alone lifts no hold.
function is_uncleared(issue: number, directory: string): boolean {
	return (
		git_common_directory.repository(directory) !== undefined &&
		read(issue, directory)?.cleared !== true
	)
}

// What an ended lane does with its plan. A cleared plan goes, so the issue's next lane plans afresh
// rather than inheriting the files and the place in line of a run that is over. A plan never cleared —
// the lane yielded on it (`lane-yield.ts`, joshuafolkken/kit#4926) — stays: `backlog:next` holds the
// issue back on it while the holder runs, and its next lane keeps the place in line it took.
function release(issue: number, directory: string): void {
	if (read(issue, directory)?.cleared === true) remove(issue, directory)
}

// `declared` with each issue's recorded plan joined to the paths its body declares.
function with_plans(declared: Declared, directory: string): Declared {
	const joined = [...declared].map(([issue, paths]): [number, ReadonlySet<string>] => [
		issue,
		new Set([...paths, ...(read(issue, directory)?.paths ?? [])]),
	])

	return new Map(joined)
}

// The `holders` that recorded their plan before `plan` — the only ones it waits on. The earlier plan
// goes first, so two lanes that plan the same file never wait on each other.
function earlier_holders(
	plan: LanePlan,
	holders: ReadonlyArray<number>,
	directory: string,
): Array<number> {
	return holders.filter((holder) => {
		const other = holder === plan.issue ? undefined : read(holder, directory)

		return other !== undefined && other.planned_at < plan.planned_at
	})
}

const lane_plan = { earlier_holders, is_uncleared, read, record, release, remove, with_plans }

export { lane_plan }
export type { LanePlan }
