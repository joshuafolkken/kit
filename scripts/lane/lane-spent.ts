import { backlog_drive_restore } from '#scripts/backlog/backlog-drive-restore'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_command } from '#scripts/git/git-command'
import { issue_state } from '#scripts/issue/issue-state'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_hold } from '#scripts/run/hold/run-hold'
import {
	PROCESS_ALIVE,
	PROCESS_NONE,
	PROCESS_UNKNOWN,
	type ProcessTrace,
} from '#scripts/run/run-liveness'
import { lane_await } from './lane-await'
import { lane_registry, type LaneInfo } from './lane-registry'

// Whether a lane is in use, and whether it is spent — the one reading `lane:prune` discards a lane
// on and `josh backlogrun` keeps a watching run on.
//
// **In use means a child is working in it, or nobody could tell.** A lane a past run left behind has
// no process, and counting it as open kept a watching run from being replaced for as long as the lane
// sat there. An unanswered probe is in use: both callers act on "nobody is here", and the lane a
// wrong answer costs is one with a child mid-change.
//
// **Spent is all five: no child, the issue closed, not in flight, a clean tree, no commit off every
// remote.** `lane:close` forces the removal, so each condition names something a close cannot give
// back — and a condition that could not be read keeps the lane, with the reason said.
//
// **A lane the running `backlogrun` still has in flight is its `run:merge`'s.** A child that merged
// while no driver watched leaves a lane that reads spent on every other count; closed here, the run
// would have no `merge` event, no ledger line and no merged count for it (`run-tidy-lanes.ts`).

const STATE_FIELD = 'state'
const CLOSED_STATE = 'CLOSED'

interface SpentProbes {
	process_trace: (issue: string) => ProcessTrace
	issue_state: (issue: string) => Promise<string | undefined>
	// The issues the running `backlogrun` launched and has not settled.
	in_flight: () => Promise<ReadonlySet<string>>
	is_tree_dirty: (directory: string) => Promise<boolean>
	unpushed_commits: (branch: string) => Promise<number | undefined>
}

interface KeptLane {
	issue: string
	reason: string
}

// The lanes that are in use, apart: a probe that did not answer is not a child seen working.
interface LaneUse {
	working: Array<string>
	unread: Array<string>
}

// One probe answer per lane: a second sample can disagree with the first, and a lane bucketed on
// two answers can land in neither list.
type TracedLane = readonly [issue: string, trace: ProcessTrace]

interface SpentSort {
	spent: Array<LaneInfo>
	kept: Array<KeptLane>
}

type Check = (lane: LaneInfo, probes: SpentProbes) => Promise<string | undefined>

async function read_issue_state(issue: string): Promise<string | undefined> {
	const json = await git_gh_issue_read.issue_view_json(issue, STATE_FIELD)

	return json === undefined ? undefined : issue_state.parse_issue_state(json)?.state
}

async function read_unpushed_commits(branch: string): Promise<number | undefined> {
	try {
		return await git_command.commit_count_unpushed(branch)
	} catch {
		return undefined
	}
}

async function read_in_flight(): Promise<ReadonlySet<string>> {
	return backlog_drive_restore.active_issues(await run_event_stream_emit.current_events())
}

const LIVE_PROBES: SpentProbes = {
	process_trace: lane_await.process_trace_default,
	issue_state: read_issue_state,
	in_flight: read_in_flight,
	is_tree_dirty: run_hold.is_tree_dirty,
	unpushed_commits: read_unpushed_commits,
}

// The one probe the in-use readings take, so a reader holding a process snapshot passes its own.
type TraceProbes = Pick<SpentProbes, 'process_trace'>

// A stranded lane has no work tree for a child to be in, so it is never in use.
function trace_of(lane: LaneInfo, probes: TraceProbes): ProcessTrace {
	return lane.is_stranded ? PROCESS_NONE : probes.process_trace(lane.issue)
}

async function child_reason(lane: LaneInfo, probes: SpentProbes): Promise<string | undefined> {
	const trace = probes.process_trace(lane.issue)

	if (trace === PROCESS_NONE) return undefined

	return trace === PROCESS_ALIVE
		? 'a child is still working in it'
		: 'whether a child is working in it could not be read'
}

async function issue_reason(lane: LaneInfo, probes: SpentProbes): Promise<string | undefined> {
	const state = await probes.issue_state(lane.issue)

	if (state === CLOSED_STATE) return undefined

	return state === undefined ? 'its issue could not be read' : 'its issue is still open'
}

async function run_reason(lane: LaneInfo, probes: SpentProbes): Promise<string | undefined> {
	const in_flight = await probes.in_flight()

	return in_flight.has(lane.issue)
		? 'the running backlogrun has not collected it yet (`pnpm josh run:merge` does)'
		: undefined
}

// `is_tree_dirty` answers dirty for a status it could not read, which is the side that keeps the lane.
async function tree_reason(lane: LaneInfo, probes: SpentProbes): Promise<string | undefined> {
	return (await probes.is_tree_dirty(lane.directory)) ? 'it has uncommitted changes' : undefined
}

async function commit_reason(lane: LaneInfo, probes: SpentProbes): Promise<string | undefined> {
	const count = await probes.unpushed_commits(lane.branch)

	if (count === 0) return undefined

	return count === undefined
		? 'its commits could not be counted'
		: `it has ${String(count)} commit(s) that are on no remote`
}

// In the order a person acts on them: a running child outranks everything, and an open issue is why
// the lane exists at all.
const CHECKS: ReadonlyArray<Check> = [
	child_reason,
	issue_reason,
	run_reason,
	tree_reason,
	commit_reason,
]

// Why the lane is kept, or `undefined` for a spent one.
async function kept_reason(
	lane: LaneInfo,
	probes: SpentProbes = LIVE_PROBES,
): Promise<string | undefined> {
	const reasons = await Promise.all(CHECKS.map(async (check) => await check(lane, probes)))

	return reasons.find((reason) => reason !== undefined)
}

// Every live lane as spent or kept. A stranded lane is neither: `lane:prune` closes it already.
async function sort_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	probes: SpentProbes = LIVE_PROBES,
): Promise<SpentSort> {
	const live = lanes.filter((lane) => !lane.is_stranded)
	const reasons = await Promise.all(live.map(async (lane) => await kept_reason(lane, probes)))
	const sorted: SpentSort = { spent: [], kept: [] }

	for (const [index, lane] of live.entries()) {
		const reason = reasons[index]

		if (reason === undefined) sorted.spent.push(lane)
		else sorted.kept.push({ issue: lane.issue, reason })
	}

	return sorted
}

function issues_traced(traced: ReadonlyArray<TracedLane>, trace: ProcessTrace): Array<string> {
	return traced.filter(([, answer]) => answer === trace).map(([issue]) => issue)
}

function traced_of(lanes: ReadonlyArray<LaneInfo>, probes: TraceProbes): Array<TracedLane> {
	return lanes.map((lane): TracedLane => [lane.issue, trace_of(lane, probes)])
}

/** The lanes in use — what a run being replaced must not be stopped over. */
async function lanes_in_use(probes: SpentProbes = LIVE_PROBES): Promise<LaneUse> {
	const traced = traced_of(await lane_registry.list_lanes(), probes)

	return {
		working: issues_traced(traced, PROCESS_ALIVE),
		unread: issues_traced(traced, PROCESS_UNKNOWN),
	}
}

/** The lanes no child is working in, read as such — never one whose probe did not answer. */
function idle_lanes(
	lanes: ReadonlyArray<LaneInfo>,
	probes: TraceProbes = LIVE_PROBES,
): Array<string> {
	return issues_traced(traced_of(lanes, probes), PROCESS_NONE)
}

const lane_spent = { idle_lanes, kept_reason, lanes_in_use, read_unpushed_commits, sort_lanes }

export type { KeptLane, LaneUse, SpentProbes, SpentSort }
export { lane_spent }
