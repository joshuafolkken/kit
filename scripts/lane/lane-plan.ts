import { backlog_overlap, type Clash, type Declared } from '#scripts/backlog/backlog-overlap'
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
// The plan is the first moment the touched files are known, so it is recorded here and read as the
// declaration in place of the body — by `lane:plan` to hold the later lane back, and by `backlog:next`.
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
	// The lane gave its lane back on this plan (`lane-yield.ts`), so the plan outlives the lane.
	yielded: z.boolean().optional(),
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
// with no common git directory cannot record a plan, so it is never asked for one. A plan recorded but
// not cleared — a yield, an unread listing — lifts no hold: the record is written before the check.
function is_uncleared(issue: number, directory: string): boolean {
	return (
		git_common_directory.repository(directory) !== undefined &&
		read(issue, directory)?.cleared !== true
	)
}

// What an ended lane does with its plan. A plan the lane yielded on (`lane-yield.ts`,
// joshuafolkken/kit#4926) stays: `backlog:next` holds the issue back on it while the holder runs, and
// its next lane keeps the place in line it took. Any other plan goes — cleared, or left by a lane that
// ended before its check answered — so the issue's next lane plans afresh rather than inheriting the
// files and the place in line of a run that is over.
function release(issue: number, directory: string): void {
	if (read(issue, directory)?.yielded !== true) remove(issue, directory)
}

// `declared` with each issue's recorded plan, if any, in place of what it declares (joshuafolkken/kit#4937).
function with_plans(declared: Declared, directory: string): Declared {
	const replaced = [...declared].map(([issue, paths]): [number, ReadonlySet<string>] => [
		issue,
		new Set(read(issue, directory)?.paths ?? paths),
	])

	return new Map(replaced)
}

// Whether `other` holds its files ahead of `plan`: it was cleared, or it planned first. A cleared lane
// may already be editing, so a kept place in line never takes its files from it.
function goes_before(other: LanePlan, plan: LanePlan): boolean {
	return other.cleared === true || other.planned_at < plan.planned_at
}

// The `holders` whose plan goes before `plan` — the only ones it yields to. Of two uncleared plans the
// earlier goes first, so two lanes that plan the same file never yield to each other.
function earlier_holders(
	plan: LanePlan,
	holders: ReadonlyArray<number>,
	directory: string,
): Array<number> {
	return holders.filter((holder) => {
		const other = holder === plan.issue ? undefined : read(holder, directory)

		return other !== undefined && goes_before(other, plan)
	})
}

// The first file of `plan` that a lane in `declared` — its recorded plan, else its body — holds ahead of
// it. `lane:plan` yields on it, and a named run holds the yielded issue back on the same answer.
function clash_of(plan: LanePlan, declared: Declared, directory: string): Clash | undefined {
	const holders = earlier_holders(plan, [...declared.keys()], directory)

	return backlog_overlap.path_clash(new Set(plan.paths), declared, holders)
}

function is_yielded(issue: number, directory: string): boolean {
	return read(issue, directory)?.yielded === true
}

// Whether `issue` yielded on a plan that a lane in `declared` still holds one of its files ahead of —
// what a named run holds the issue back on, as `backlog:next` does on the same kept plan
// (joshuafolkken/kit#4926). Without it the run relaunches the issue at once, and the lane yields again.
function is_yield_held(issue: number, declared: Declared, directory: string): boolean {
	const plan = read(issue, directory)

	return plan?.yielded === true && clash_of(plan, declared, directory) !== undefined
}

const lane_plan = {
	clash_of,
	earlier_holders,
	is_uncleared,
	is_yield_held,
	is_yielded,
	read,
	record,
	release,
	remove,
	with_plans,
}

export { lane_plan }
export type { LanePlan }
