import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { backlog_drive_retrospective } from './backlog-drive-retrospective'
import { backlogrun_stop } from './backlogrun-stop'

// Whether `josh backlogrun` may replace the run already going with the one just typed. A run that
// drained its backlog keeps watching for hours with nothing in flight, and starting another meant typing
// `--stop` first; this is the test that lets the start do both.
//
// **A different invocation, a watching run, no open lane — all three.** The same invocation is how a
// person reopens the board, so it never rebuilds the run. A run still starting is opening a lane, and a
// child killed mid-change leaves a tree nobody can resume, so only a run past its drain is replaced.
//
// **A drain that still owes the retrospective is not the watch.** The drain is marked before the
// end-of-run retrospective runs, so a run owing one has a session at work on it; stopping that session
// loses the retrospective with the record, and the run is kept until it has run.
//
// **An undetermined run is not replaced.** No carry record — a launch its parent has not claimed yet —
// or a scope that cannot be read answers `false`, the side that keeps the run.

const KIND = run_event_stream.EVENT_KIND
const NOT_FOUND = -1

interface ReplacePorts {
	read_carry: (git_directory: string) => CarryRead
	events: (git_directory: string) => ReadonlyArray<RunEvent>
	is_retrospective_owed: (carry: RunCarry) => boolean
	lanes: () => Promise<ReadonlyArray<string>>
}

const LIVE_PORTS: ReplacePorts = {
	read_carry: (git_directory) => run_carry.read_carry(run_carry.carry_path(git_directory)),
	events: (git_directory) =>
		run_event_stream.read_events(run_event_stream.target_of(git_directory)),
	is_retrospective_owed: backlog_drive_retrospective.is_owed,
	lanes: backlogrun_stop.open_lanes,
}

function is_different(invocation: string, read: CarryRead): boolean {
	return read.kind === 'carried' && read.carry.invocation !== invocation
}

function owes_retrospective(read: CarryRead, ports: ReplacePorts): boolean {
	return read.kind === 'carried' && ports.is_retrospective_owed(read.carry)
}

// Watching is the run's newest drain with no launch after it: a child the watch woke for ends it.
function is_watching(events: ReadonlyArray<RunEvent>, read: CarryRead): boolean {
	const scoped = run_event_scope.scoped_events(events, run_event_scope.scope_of(read)) ?? []
	const drained_at = scoped.findLastIndex((event) => event.kind === KIND.DRAIN)

	if (drained_at === NOT_FOUND) return false

	return scoped.slice(drained_at).every((event) => event.kind !== KIND.CHILD_LAUNCH)
}

async function is_replaceable(
	invocation: string,
	git_directory: string,
	ports: ReplacePorts = LIVE_PORTS,
): Promise<boolean> {
	const read = ports.read_carry(git_directory)

	if (!is_different(invocation, read) || owes_retrospective(read, ports)) return false

	const events = ports.events(git_directory)

	if (!is_watching(events, read)) return false

	const lanes = await ports.lanes()

	return lanes.length === 0
}

const backlogrun_replace = { is_replaceable }

export type { ReplacePorts }
export { backlogrun_replace }
