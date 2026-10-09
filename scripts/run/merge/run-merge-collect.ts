import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { issue_merged } from '#scripts/issue/issue-merged'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { run_carry, type CarryOwner, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_merge } from './run-merge'
import { run_merge_cli } from './run-merge-cli'

type IssueRead = Awaited<ReturnType<typeof issue_state_cli.read_issue>>

// The merges a run ends with, recorded at `run:carry --end`. `backlog:drive` collects only the lanes
// it holds in memory, and a restarted driver reseeds them from the open lanes, so a lane that merged
// while no driver watched it never reached `run:merge`: no `merge` event, no ledger line, no merged
// count. Each lane still open on a child the run launched and never settled is read once more, and
// **only a merged one is collected** — closed by a merged pull request, or left open behind one —
// through the same `run:merge` recording a driver would have made.

interface Merge {
	// The merged pull request GitHub left the child open behind, which `run:merge` still closes it for.
	merged_pr: string | undefined
}

// A closed child merged only when a merged pull request closed it; one closed by hand is not collected.
async function closed_merge(child: string): Promise<Merge | undefined> {
	return (await issue_merged.read_merged(child)) ? { merged_pr: undefined } : undefined
}

async function open_merge(child: string, read: IssueRead): Promise<Merge | undefined> {
	const merged_pr = await run_merge_cli.read_merged_pr(child, read)

	return merged_pr === undefined ? undefined : { merged_pr }
}

// How the child merged; `undefined` when it did not, or could not be read.
async function merge_of(child: string): Promise<Merge | undefined> {
	const read = await issue_state_cli.read_issue(child)

	if (read.kind !== 'state') return undefined

	const is_closed = run_merge.classify_child(read.state) === 'merged'

	return is_closed ? await closed_merge(child) : await open_merge(child, read)
}

// A lane a detached `josh ship` still supervises is that ship's to merge.
async function collect_lane(lane: LaneInfo, owner: CarryOwner): Promise<void> {
	if (lane_handoff.is_ship_running(lane.issue, process.cwd())) return

	const merge = await merge_of(lane.issue)

	if (merge === undefined) return

	const ctx = { child: lane.issue, epic: undefined, repo: undefined, over: undefined, owner }

	await run_merge_cli.record_merged({ ...ctx, merged_pr: merge.merged_pr })
}

// **Best-effort, one lane at a time**: a close prunes the worktree list, and a lane that fails to
// collect is reported and left for `run:tidy` rather than failing the `--end` that asked.
async function collect_all(lanes: ReadonlyArray<LaneInfo>, owner: CarryOwner): Promise<void> {
	for (const lane of lanes) {
		try {
			// eslint-disable-next-line no-await-in-loop -- a close prunes the worktree list the next one reads
			await collect_lane(lane, owner)
		} catch (error) {
			console.error(
				`run:carry: lane ${session_cite.issue(lane.issue)} was not collected: ${String(error)}`,
			)
		}
	}
}

// `--end` speaks for the run whose record it closes, so the collection counts as the record's owner.
function owner_of(carry: RunCarry): CarryOwner {
	return { pid: carry.owner_pid, start: carry.owner_start, transcript: carry.owner_transcript }
}

async function collect_carried(carry: RunCarry): Promise<void> {
	const in_flight = backlog_drive_restore.active_issues(
		await run_event_stream_emit.current_events(),
	)
	const lanes = await lane_registry.list_lanes()
	const collectable = lanes.filter((lane) => !lane.is_stranded && in_flight.has(lane.issue))

	await collect_all(collectable, owner_of(carry))
}

// Asked by `--end` before it closes the record under `directory`, the common git directory; a run with
// no live record collects nothing. **It never fails the `--end` that asked**.
async function collect_merged(directory: string): Promise<void> {
	const read = run_carry.read_carry(run_carry.carry_path(directory))

	if (read.kind !== 'carried' && read.kind !== 'expired') return

	try {
		await collect_carried(read.carry)
	} catch (error) {
		console.error(`run:carry: the run's merged lanes were not collected: ${String(error)}`)
	}
}

const run_merge_collect = { collect_merged }

export { run_merge_collect }
