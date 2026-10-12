import { process_identity } from '#scripts/josh/process-identity'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_end } from '#scripts/run/carry/run-carry-end'
import { run_wake, type RunWake } from '#scripts/run/wake/run-wake'
import { run_wake_stop } from '#scripts/run/wake/run-wake-stop'
import { backlogrun_launch } from './backlogrun-launch'

// `josh backlogrun --stop` — the order a `backlogrun` is stopped in, and what is said of it. Each stop
// is the one its own command already makes (`run:wake --stop`, `run:carry --end --stopped`); only the
// order is here.
//
// **Supervisor, then parent, then record.** A record ended first is one a supervisor or a parent still
// alive can write back, and a supervisor still watching would wake a session over the run just ended.
//
// **Only what `josh backlogrun` started is stopped.** A run a person typed into a session of their own
// is owned by that session; its record is kept and the owner is named, because ending a record under a
// live owner leaves a session running lanes nothing counts.
//
// **A session the supervisor woke is the run's own.** It is headless — nobody can end the run from it —
// so when it holds the record it is stopped with the supervisor that started it.
//
// **Lanes are counted, never stopped**: a child killed mid-change leaves a tree nobody can resume.

const STOPPED_REASON = 'stopped by a person with `josh backlogrun --stop`'
const PREFIX = 'backlogrun:'
const ISSUE_PREFIX = '#'

// The supervisor that was stopped, with the session it last woke.
type StoppedSupervisor = Pick<RunWake, 'pid' | 'woke_pid'>

type RecordOutcome = { kind: 'none' } | { kind: 'ended' } | { kind: 'held'; owner: number }

interface StopReport {
	// The pids stopped, `undefined` where there was nothing to stop.
	supervisor: number | undefined
	parent: number | undefined
	// The session the supervisor woke, stopped only where it held the record.
	session: number | undefined
	record: RecordOutcome
	// The issues whose lanes are still open, left running.
	lanes: ReadonlyArray<string>
}

interface StopPorts {
	stop_supervisor: (git_directory: string) => StoppedSupervisor | undefined
	stop_parent: (git_directory: string) => number | undefined
	stop_session: (pid: number) => void
	read_carry: (git_directory: string) => CarryRead
	is_live: (pid: number, start: string | undefined) => boolean
	end_record: (git_directory: string) => Promise<CarryRead>
	lanes: () => Promise<Array<string>>
}

async function open_lanes(): Promise<Array<string>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.filter((lane) => !lane.is_stranded).map((lane) => lane.issue)
}

// A person who typed the stop is at the terminal, so the ⏸️ confirmation a stop pushes is not sent.
const LIVE_PORTS: StopPorts = {
	stop_supervisor: (git_directory) => run_wake_stop.stop(run_wake.wake_path(git_directory)),
	stop_parent: backlogrun_launch.stop_parent,
	stop_session: run_wake_stop.signal,
	read_carry: (git_directory) => run_carry.read_carry(run_carry.carry_path(git_directory)),
	is_live: (pid, start) => process_identity.is_same_process(pid, start) !== false,
	end_record: async (git_directory) =>
		await run_carry_end.end_run(git_directory, { stopped: STOPPED_REASON, is_announced: false }),
	lanes: open_lanes,
}

function live_owner(carry: RunCarry, ports: StopPorts): number | undefined {
	const { owner_pid, owner_start } = carry

	if (owner_pid === undefined) return undefined

	return ports.is_live(owner_pid, owner_start) ? owner_pid : undefined
}

// The live owner this command did not just stop.
function standing_owner(
	read: CarryRead,
	stopped: ReadonlyArray<number | undefined>,
	ports: StopPorts,
): number | undefined {
	const owner = read.kind === 'carried' ? live_owner(read.carry, ports) : undefined

	return stopped.includes(owner) ? undefined : owner
}

// Stops the owner where it is the session the stopped supervisor woke — the pid stopped, `undefined`
// where the owner is any other process, which this command has no business signalling.
function stop_woken(
	owner: number | undefined,
	wake: StoppedSupervisor | undefined,
	ports: StopPorts,
): number | undefined {
	if (owner === undefined || owner !== wake?.woke_pid) return undefined

	ports.stop_session(owner)

	return owner
}

async function close_record(
	git_directory: string,
	read: CarryRead,
	holder: number | undefined,
	ports: StopPorts,
): Promise<RecordOutcome> {
	if (read.kind === 'none') return { kind: 'none' }
	if (holder !== undefined) return { kind: 'held', owner: holder }

	await ports.end_record(git_directory)

	return { kind: 'ended' }
}

async function stop(git_directory: string, ports: StopPorts = LIVE_PORTS): Promise<StopReport> {
	const wake = ports.stop_supervisor(git_directory)
	const parent = ports.stop_parent(git_directory)
	const read = ports.read_carry(git_directory)
	const owner = standing_owner(read, [wake?.pid, parent], ports)
	const session = stop_woken(owner, wake, ports)
	const holder = session === undefined ? owner : undefined
	const record = await close_record(git_directory, read, holder, ports)
	const lanes = await ports.lanes()

	return { supervisor: wake?.pid, parent, session, record, lanes }
}

function process_line(what: string, pid: number | undefined): Array<string> {
	return pid === undefined ? [] : [`${PREFIX} stopped the ${what} (process ${String(pid)})`]
}

function record_lines(outcome: RecordOutcome): Array<string> {
	if (outcome.kind === 'none') return []
	if (outcome.kind === 'ended') return [`${PREFIX} ended the run's record`]

	return [
		`${PREFIX} process ${String(outcome.owner)} owns the run and was not started by \`josh backlogrun\`; its record is kept — end the run from that session`,
	]
}

function lane_lines(lanes: ReadonlyArray<string>): Array<string> {
	if (lanes.length === 0) return []

	const issues = lanes.map((issue) => `${ISSUE_PREFIX}${issue}`).join(' ')

	return [`${PREFIX} ${String(lanes.length)} lane(s) still running, not stopped: ${issues}`]
}

// What a person reads back: one line per thing done, or the one line that says nothing was running.
function lines_of(report: StopReport): Array<string> {
	const done = [
		...process_line('supervisor', report.supervisor),
		...process_line('parent session', report.parent),
		...process_line('session the supervisor woke', report.session),
		...record_lines(report.record),
	]
	const stopped = done.length === 0 ? [`${PREFIX} nothing is running`] : done

	return [...stopped, ...lane_lines(report.lanes)]
}

// A record left with its owner is a run this command did not stop.
function is_stopped(report: StopReport): boolean {
	return report.record.kind !== 'held'
}

const backlogrun_stop = { is_stopped, lines_of, stop }

export type { StopPorts, StopReport }
export { backlogrun_stop }
