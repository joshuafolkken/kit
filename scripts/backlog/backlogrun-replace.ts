import { lane_spent, type LaneUse } from '#scripts/lane/lane-spent'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { backlog_drive_retrospective } from './backlog-drive-retrospective'
import { backlogrun_launch } from './backlogrun-launch'

// Whether `josh backlogrun` may replace the run already going with the one just typed. A run that
// drained its backlog keeps watching for hours with nothing in flight, and starting another meant typing
// `--stop` first; this is the test that lets the start do both.
//
// **A different invocation, a watching run, no lane in use — all three.** The same invocation is how a
// person reopens the board, so it never rebuilds the run. A run still starting is opening a lane, and a
// child killed mid-change leaves a tree nobody can resume, so only a run past its drain is replaced.
//
// **Only a lane a child is working in keeps the run.** A lane a past run left behind has nobody in it;
// counted as open, it kept every later invocation from replacing the run (`lane-spent.ts`).
//
// **A drain that still owes the retrospective is not the watch.** The drain is marked before the
// end-of-run retrospective runs, so a run owing one has a session at work on it; stopping that session
// loses the retrospective with the record, and the run is kept until it has run.
//
// **An undetermined run is not replaced.** A record or a scope that cannot be read answers `keep`, the
// side that keeps the run.
//
// **A launch its parent has not claimed yet is still starting, not unreadable.** No carry record stands
// then, so the invocation is read from the launch record: the same one is the board reopened, and any
// other is kept as a run that has not written its record yet.
//
// **A kept run says why.** Every `keep` carries the one condition that held it, because a board shown
// with no word looked the same whichever of them it was.

const KIND = run_event_stream.EVENT_KIND
const NOT_FOUND = -1
const ISSUE_PREFIX = '#'
const UNREADABLE_REASON = "the run's record could not be read"
const UNCLAIMED_REASON = 'the run is still starting: it has not written its record yet'
const WORKING_LANE = 'a child is still working in the lane for'
const UNREAD_LANE = 'whether a child is working could not be read in the lane for'
const LANE_WAY_OUT = '(`pnpm josh lane:close <N>` discards a lane)'
const RETROSPECTIVE_REASON = 'the run still owes its retrospective'
const WORKING_REASON = 'the run is not watching: it is still starting or has a child at work'

// `same` is the board reopened, which is kept without a word; `keep` is a refusal, and says why.
type ReplaceVerdict = { kind: 'replace' } | { kind: 'same' } | { kind: 'keep'; reason: string }

const REPLACE: ReplaceVerdict = { kind: 'replace' }
const SAME: ReplaceVerdict = { kind: 'same' }

interface ReplacePorts {
	read_carry: (git_directory: string) => CarryRead
	events: (git_directory: string) => ReadonlyArray<RunEvent>
	is_retrospective_owed: (carry: RunCarry) => boolean
	// The invocation of a launch whose parent has not claimed the record yet.
	pending_invocation: (git_directory: string) => string | undefined
	// The lanes in use: a child working in one, or a probe that did not answer.
	lanes: () => Promise<LaneUse>
}

const LIVE_PORTS: ReplacePorts = {
	read_carry: (git_directory) => run_carry.read_carry(run_carry.carry_path(git_directory)),
	events: (git_directory) =>
		run_event_stream.read_events(run_event_stream.target_of(git_directory)),
	is_retrospective_owed: backlog_drive_retrospective.is_owed,
	pending_invocation: (git_directory) =>
		backlogrun_launch.pending_launch(git_directory)?.invocation,
	lanes: async () => await lane_spent.lanes_in_use(),
}

function keep(reason: string): ReplaceVerdict {
	return { kind: 'keep', reason }
}

// What the record alone settles, or `undefined` for a different invocation that owes nothing.
function record_verdict(
	invocation: string,
	read: CarryRead,
	ports: ReplacePorts,
): ReplaceVerdict | undefined {
	if (read.kind !== 'carried') return keep(UNREADABLE_REASON)
	if (read.carry.invocation === invocation) return SAME

	return ports.is_retrospective_owed(read.carry) ? keep(RETROSPECTIVE_REASON) : undefined
}

// A launch with no carry record yet, answered from the launch record.
function unclaimed_verdict(pending: string | undefined, invocation: string): ReplaceVerdict {
	return pending === invocation ? SAME : keep(UNCLAIMED_REASON)
}

// Watching is the run's newest drain with no launch after it: a child the watch woke for ends it.
function is_watching(scoped: ReadonlyArray<RunEvent>): boolean {
	const drained_at = scoped.findLastIndex((event) => event.kind === KIND.DRAIN)

	if (drained_at === NOT_FOUND) return false

	return scoped.slice(drained_at).every((event) => event.kind !== KIND.CHILD_LAUNCH)
}

function watch_verdict(
	git_directory: string,
	read: CarryRead,
	ports: ReplacePorts,
): ReplaceVerdict {
	const events = ports.events(git_directory)
	const scoped = run_event_scope.scoped_events(events, run_event_scope.scope_of(read))

	if (scoped === undefined) return keep(UNREADABLE_REASON)

	return is_watching(scoped) ? REPLACE : keep(WORKING_REASON)
}

function named(lead: string, issues: ReadonlyArray<string>): Array<string> {
	if (issues.length === 0) return []

	const cited = issues.map((issue) => `${ISSUE_PREFIX}${issue}`).join(' ')

	return [`${lead} ${cited}`]
}

// The lanes are named with the command that discards one, the only way past a child that will not end —
// and a probe that did not answer is said as that, because the close takes a lane's uncommitted work.
function lane_reason(use: LaneUse): string {
	const parts = [...named(WORKING_LANE, use.working), ...named(UNREAD_LANE, use.unread)]

	return `${parts.join('; ')} ${LANE_WAY_OUT}`
}

function is_free(use: LaneUse): boolean {
	return use.working.length === 0 && use.unread.length === 0
}

async function claimed_verdict(
	invocation: string,
	git_directory: string,
	read: CarryRead,
	ports: ReplacePorts,
): Promise<ReplaceVerdict> {
	const settled =
		record_verdict(invocation, read, ports) ?? watch_verdict(git_directory, read, ports)

	if (settled.kind !== 'replace') return settled

	const use = await ports.lanes()

	return is_free(use) ? REPLACE : keep(lane_reason(use))
}

async function decide(
	invocation: string,
	git_directory: string,
	ports: ReplacePorts = LIVE_PORTS,
): Promise<ReplaceVerdict> {
	const read = ports.read_carry(git_directory)

	if (read.kind === 'none') {
		return unclaimed_verdict(ports.pending_invocation(git_directory), invocation)
	}

	return await claimed_verdict(invocation, git_directory, read, ports)
}

const backlogrun_replace = { decide }

export type { ReplacePorts, ReplaceVerdict }
export { backlogrun_replace }
