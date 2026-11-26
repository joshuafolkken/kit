import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { epic_busy, type BusyRead } from '#scripts/epic/epic-busy'
import { epic_solo_stale } from '#scripts/epic/epic-solo-stale'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { lane_plan } from '#scripts/lane/lane-plan'
import { lane_state, type LaneRecords } from '#scripts/lane/lane-state'
import { backlog_overlap, type Declared } from './backlog-overlap'
import { backlog_plan_comment, type PoolIssue } from './backlog-plan-comment'

interface NamedScope {
	read: BusyRead
	repo: string
	declared: Declared
	lanes: LaneRecords
}

// The opted-in listing `lane:plan` reads the bodies from; an unread listing carries none.
async function listed(): Promise<ReadonlyArray<OpenIssueData>> {
	const listing = await auto_ok_cli.fetch_opted_in()

	return listing.kind === 'read' ? listing.issues : []
}

// What `numbers` declare — recorded plan, else plan comment, else body, the scope `lane:plan` and
// `backlog:next` read; a plan comment posted after the record wins (joshuafolkken/kit#6798). An issue
// `issues` does not carry, or an unread listing, declares its plan alone.
async function declared_among(
	numbers: ReadonlyArray<number>,
	issues: ReadonlyArray<PoolIssue>,
): Promise<Declared> {
	const pool = [...new Set(numbers)].map(
		(number) => issues.find((issue) => issue.number === number) ?? { number },
	)

	return await backlog_plan_comment.declared_of(pool, process.cwd())
}

// The declared paths of the gathered issues, the lanes in flight and the running holders, read from
// the listing's bodies as `lane:plan` reads them (joshuafolkken/kit#9031), with each holder's plan.
async function declared_of(numbers: ReadonlyArray<number>, busy: BusyRead): Promise<Declared> {
	const running = backlog_overlap.running_numbers(busy)
	const declared = await declared_among([...numbers, ...running], await listed())

	return lane_plan.with_holder_plans(declared, running, process.cwd())
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

export const backlog_drive_named_scope = { declared_among, listed, read }
