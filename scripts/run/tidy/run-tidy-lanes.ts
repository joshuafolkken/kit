import { git_spawn } from '#scripts/git/git-spawn'
import { git_stash } from '#scripts/git/stash/git-stash'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_close } from '#scripts/lane/lane-close'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { error_text } from '#scripts/lib/error-message'
import { run_hold } from '#scripts/run/hold/run-hold'
import { run_tidy, type Outcome, type Verdict } from './run-tidy'

// The lane half of `josh run:tidy`: each lane whose issue merged, read for what would make closing it
// lose work, then closed with its run record released. A lane whose work tree is already gone is
// `lane:prune`'s, so it is left to that command. A lane the running `backlogrun` still has in flight
// is left to its `run:merge`: closed here, it would leave the run with no `merge` event, no ledger
// line and no merged count.

const CLOSED_KIND = 'closed'
const INCOMPLETE_REASON = 'the close left files behind'
const NOT_MERGED_REASON = 'not merged'

type IsMerged = (issue: string) => Promise<boolean>

// Any commit on the lane's branch that no remote-tracking ref reaches — `HEAD --not --remotes` — is
// work only this tree holds. A branch merged upstream is reached through the default branch even after
// its own remote branch was deleted, so a merged lane answers zero. A failed read keeps the lane.
async function has_unpushed(directory: string): Promise<boolean> {
	try {
		const count = await git_spawn.read([
			'-C',
			directory,
			'rev-list',
			'--count',
			'HEAD',
			'--not',
			'--remotes',
		])

		return count !== '0'
	} catch (error) {
		error_text.trace_swallowed('run_tidy_lanes.has_unpushed', error)

		return true
	}
}

async function hold_path_of(directory: string): Promise<string> {
	const git_directory = await git_spawn.read(['-C', directory, 'rev-parse', '--absolute-git-dir'])

	return run_hold.hold_path(git_directory)
}

// A live record belongs to a run still inside that tree — one finishing its post-merge steps — so the
// lane waits for the next sweep; an unreadable record is kept for the same reason.
function is_running(hold_path: string): boolean {
	const read = run_hold.read_hold(hold_path)

	return read.kind === 'held' || read.kind === 'unreadable'
}

// Asked only of a lane already read as merged, so the rule's "not merged" answer cannot come back.
async function lane_verdict(lane: LaneInfo, hold_path: string): Promise<Verdict> {
	const verdict = run_tidy.lane_verdict({
		issue: lane.issue,
		is_merged: true,
		has_changes: await git_stash.has_changes(lane.directory),
		has_unpushed: await has_unpushed(lane.directory),
		is_running: is_running(hold_path),
	})

	return verdict ?? run_tidy.keep(NOT_MERGED_REASON)
}

async function close(issue: string, hold_path: string): Promise<Verdict> {
	const outcome = await lane_close.close_lane(issue)

	if (outcome.kind !== CLOSED_KIND) return run_tidy.keep(INCOMPLETE_REASON)

	run_hold.release_hold(hold_path)

	return run_tidy.CLEAN
}

async function settle(lane: LaneInfo): Promise<Verdict> {
	try {
		const hold_path = await hold_path_of(lane.directory)
		const verdict = await lane_verdict(lane, hold_path)

		return verdict.kind === 'clean' ? await close(lane.issue, hold_path) : verdict
	} catch (error) {
		return run_tidy.keep(String(error))
	}
}

async function tidy_lane(
	lane: LaneInfo,
	is_merged: IsMerged,
	in_flight: ReadonlySet<string>,
): Promise<Outcome | undefined> {
	if (in_flight.has(lane.issue)) return undefined
	if (lane.is_stranded || !(await is_merged(lane.issue))) return undefined

	return { target: `lane ${session_cite.issue(lane.issue)}`, verdict: await settle(lane) }
}

// One lane at a time: a close removes a work tree and prunes the worktree list the next read uses.
async function tidy_lanes(
	is_merged: IsMerged,
	in_flight: ReadonlySet<string> = new Set(),
): Promise<Array<Outcome>> {
	const outcomes: Array<Outcome> = []
	const lanes = await lane_registry.list_lanes()

	for (const lane of lanes) {
		// eslint-disable-next-line no-await-in-loop -- a close prunes the worktree list the next one reads
		const outcome = await tidy_lane(lane, is_merged, in_flight)

		if (outcome !== undefined) outcomes.push(outcome)
	}

	return outcomes
}

const run_tidy_lanes = { has_unpushed, tidy_lanes }

export type { IsMerged }
export { run_tidy_lanes }
