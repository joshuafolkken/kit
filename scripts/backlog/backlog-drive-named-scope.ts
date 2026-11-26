import { epic_busy, type BusyRead } from '#scripts/epic/epic-busy'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state, type LaneRecords } from '#scripts/lane/lane-state'
import { backlog_overlap, type Declared } from './backlog-overlap'
import { backlog_plan_comment } from './backlog-plan-comment'

interface NamedScope {
	read: BusyRead
	repo: string
	declared: Declared
	lanes: LaneRecords
}

// The declared paths of the gathered issues and the lanes in flight, with each running holder's plan.
async function declared_of(numbers: ReadonlyArray<number>, busy: BusyRead): Promise<Declared> {
	const directory = process.cwd()
	const declared = await backlog_plan_comment.declared_of(
		numbers.map((number) => ({ number })),
		directory,
	)

	return lane_plan.with_holder_plans(declared, backlog_overlap.running_numbers(busy), directory)
}

// What the pool's gate reads (`backlog-gate-scope.ts`), for the gathered named issues and the lanes in
// flight: the busy listing with stale solo holders released, the declared paths, and the lane records.
// An unreadable repository is `undefined`.
async function read(
	numbers: ReadonlyArray<number>,
	in_flight: ReadonlyArray<string>,
): Promise<NamedScope | undefined> {
	const repo = await git_gh_command.repo_get_name_with_owner()
	if (repo === undefined) return undefined
	const released = await epic_solo_stale.release(await epic_busy.read_repository(repo), repo)
	if (released.notice !== undefined) console.error(released.notice)
	const declared = await declared_of([...numbers, ...in_flight.map(Number)], released.read)
	const lanes = await lane_state.read_states(numbers.map(String))

	return { read: released.read, repo, declared, lanes }
}

export const backlog_drive_named_scope = { read }
