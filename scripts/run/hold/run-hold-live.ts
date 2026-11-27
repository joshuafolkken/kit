import { git_directory } from '#scripts/discovery/git-directory'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { run_hold, type RunHold } from './run-hold'

// The run a checkout's hold says is running now: its issue and the session process that took it
// (`run_hold.session_owner`). A run in the root checkout carries no lane child's mark, so this is the
// record `run:board` reads it by — its `implement` phase and its processes' usage (joshuafolkken/kit#8922).
// **A live owner only:** a stale hold — its session gone — a stop-marked one, whose session has ended by
// design, and one with no owner recorded name no running process, so they answer nothing; a person's
// own session holds nothing and is never counted as a run.

interface LiveHold {
	issue: string
	pid: number
}

function is_run_hold(hold: RunHold): boolean {
	return !run_hold.is_stop_marked(hold) && issue_number_shape.is_issue_number(hold.issue)
}

function owner_of(hold: RunHold): LiveHold | undefined {
	if (hold.owner_pid === undefined || !is_run_hold(hold)) return undefined

	return { issue: hold.issue, pid: hold.owner_pid }
}

// The live hold in a git directory itself — the primary checkout's, read by a driver that knows only
// the repository's git directory (`backlog-drive-holder.ts`).
function live_hold_at(git_folder: string, now: Date = new Date()): LiveHold | undefined {
	const read = run_hold.read_hold(run_hold.hold_path(git_folder), now)

	return read.kind === 'held' ? owner_of(read.hold) : undefined
}

function live_hold(directory: string, now: Date = new Date()): LiveHold | undefined {
	const own = git_directory.own_git_directory(directory)

	return own === undefined ? undefined : live_hold_at(own, now)
}

// The issue of the live hold whose session `ancestry` runs under; the ancestry is read only when a hold
// is live, since it walks the process table.
function held_by(directory: string, ancestry: () => ReadonlySet<number>): string | undefined {
	const hold = live_hold(directory)

	if (hold === undefined) return undefined

	return ancestry().has(hold.pid) ? hold.issue : undefined
}

const run_hold_live = { held_by, live_hold, live_hold_at }

export { run_hold_live }
export type { LiveHold }
