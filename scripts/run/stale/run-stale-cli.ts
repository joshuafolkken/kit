import { repo_discovery } from '#scripts/discovery/repo-discovery'
import { epic_busy } from '#scripts/epic/epic-busy'
import { epic_label_age } from '#scripts/epic/epic-label-age'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_command } from '#scripts/git/git-command'
import { git_spawn } from '#scripts/git/git-spawn'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_residents } from '#scripts/lane/lane-residents'
import { run_hold, type HoldRead } from '#scripts/run/hold/run-hold'
import { run_label } from '#scripts/run/run-label'
import { run_stale, type StalePorts } from './run-stale'

// The live ports of `josh run:stale`: the `in-progress` listing `epic:next` reads, the label's age
// from the issue timeline, and each checkout's run record and `git status`.

// An unnamed repository reads as an unreadable listing.
async function read_holders(repo: string | undefined): Promise<ReadonlyArray<number> | undefined> {
	if (repo === undefined) return undefined

	const read = await epic_busy.read_repository(repo)
	if (read.kind === 'idle') return []

	return read.kind === 'busy' ? read.issues.map((issue) => issue.number) : undefined
}

async function read_hold(directory: string): Promise<HoldRead> {
	try {
		const git_directory = await git_spawn.read(['-C', directory, 'rev-parse', '--absolute-git-dir'])

		return run_hold.read_hold(run_hold.hold_path(git_directory))
	} catch {
		return { kind: 'unreadable' }
	}
}

// Whether the primary checkout's record may hold the issue: it names it, or it cannot be read — never
// read as free, so the hold checks run there and keep the label.
function may_hold(read: HoldRead, issue: number): boolean {
	if (read.kind === 'unreadable') return true

	return read.kind !== 'free' && read.hold.issue === String(issue)
}

// The issue's lane, else the primary checkout when its run record may name the issue — an interactive
// run holds the label from there.
async function checkout_of(issue: number): Promise<string | undefined> {
	const lanes = await lane_registry.list_lanes()
	const lane = lanes.find((candidate) => candidate.issue === String(issue))
	if (lane !== undefined) return lane.directory

	const root = repo_discovery.main_worktree(await git_command.repository_root())

	return may_hold(await read_hold(root), issue) ? root : undefined
}

// An unreadable process listing counts as a resident: the label is kept rather than guessed away.
function has_residents(issue: number, directory: string): boolean {
	const residents = lane_residents.residents({ issue: String(issue), directory })

	return residents === undefined || residents.length > 0
}

function live_ports(repo: string | undefined): StalePorts {
	return {
		now: () => new Date(),
		read_holders: async () => await read_holders(repo),
		read_labeled_at: async (issue) => await epic_label_age.read_labeled_at(issue, repo ?? ''),
		checkout_of,
		read_hold,
		is_tree_dirty: async (directory) => await run_hold.is_tree_dirty(directory),
		has_residents,
		unmark: async (issue) => await run_label.unmark(String(issue)),
	}
}

async function run(): Promise<number> {
	const repo = await git_gh_command.repo_get_name_with_owner()

	return await run_stale.run(live_ports(repo))
}

const run_stale_cli = {
	run,
}

export { run_stale_cli }
