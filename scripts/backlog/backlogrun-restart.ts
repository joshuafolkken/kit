import type { AgentProfile } from '#scripts/agent/agent-role-profile'
import { run_board_cli } from '#scripts/run/board/run-board-cli'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_carry_ended, type EndedRun } from '#scripts/run/carry/run-carry-ended'
import { run_wake } from '#scripts/run/wake/run-wake'
import { run_wake_cli } from '#scripts/run/wake/run-wake-cli'
import { backlogrun_stop, type StopReport } from './backlogrun-stop'

// `josh backlogrun --restart` — the run's processes replaced, its record kept. The supervisor, the
// parent and a headless session are stopped as `--stop` stops them, the record is left standing, and a
// supervisor started on the stopped one's profile adopts it: the budget, the counters and the named list
// carry over, and the plan made at the start is not made again.
//
// **Only a run with a record is restarted.** No record is nothing to restart; a record `--end` closed
// is a run that is over, and the line names the invocation that starts it again rather than reviving it.
// A run owned by a session this command may not signal is refused as `--stop` refuses it.
//
// **No parent session is started.** The driver (`backlog:drive`) does the routine work, and the
// supervisor wakes a session only where a decision is needed.

const PREFIX = 'backlogrun:'
const ISSUE_PREFIX_PATTERN = /^#/u
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface RestartPorts {
	read_carry: (git_directory: string) => CarryRead
	read_ended: (git_directory: string) => EndedRun | undefined
	read_profile: (git_directory: string) => AgentProfile | undefined
	stop: (git_directory: string) => Promise<StopReport>
	start_supervisor: (git_directory: string, profile: AgentProfile | undefined) => number
	show_board: () => Promise<number>
	write: (line: string) => void
}

const LIVE_PORTS: RestartPorts = {
	read_carry: (git_directory) => run_carry.read_carry(run_carry.carry_path(git_directory)),
	read_ended: (git_directory) =>
		run_carry_ended.read_ended(run_carry_ended.ended_path(git_directory)),
	read_profile: (git_directory) => run_wake.read_wake(run_wake.wake_path(git_directory))?.profile,
	stop: async (git_directory) => await backlogrun_stop.stop_keeping_record(git_directory),
	start_supervisor: run_wake_cli.restart_supervisor,
	show_board: async () => await run_board_cli.run([]),
	write: (line) => process.stdout.write(`${line}\n`),
}

// The shell reads an unquoted `#N` as a comment, so the named list is written as bare numbers, which
// `josh backlogrun` reads back as issues.
function typed_invocation(invocation: string): string {
	const tokens = invocation.split(' ').map((token) => token.replace(ISSUE_PREFIX_PATTERN, ''))

	return `pnpm josh ${tokens.join(' ')}`
}

// Why nothing is restarted where the record is not carried.
function refusal_of(read: CarryRead, ended: EndedRun | undefined): string {
	if (read.kind === 'unreadable') return `${PREFIX} the run's record could not be read`
	if (ended === undefined) return `${PREFIX} nothing to restart`

	return `${PREFIX} the run has ended; start it again with \`${typed_invocation(ended.invocation)}\``
}

function refuse(line: string, ports: RestartPorts): number {
	ports.write(line)

	return FAILURE_EXIT_CODE
}

// The supervisor's profile is read before it is stopped, since stopping it removes the record that
// holds it; the new one runs on the same provider whatever shell the restart was typed in.
async function replace(git_directory: string, ports: RestartPorts): Promise<number> {
	const profile = ports.read_profile(git_directory)
	const report = await ports.stop(git_directory)

	for (const line of backlogrun_stop.lines_of(report)) ports.write(line)

	if (!backlogrun_stop.is_stopped(report)) return FAILURE_EXIT_CODE

	if (ports.start_supervisor(git_directory, profile) !== SUCCESS_EXIT_CODE) {
		return refuse(`${PREFIX} could not start the supervisor`, ports)
	}

	return await ports.show_board()
}

async function restart(git_directory: string, ports: RestartPorts = LIVE_PORTS): Promise<number> {
	const read = ports.read_carry(git_directory)

	if (read.kind === 'carried') return await replace(git_directory, ports)

	return refuse(refusal_of(read, ports.read_ended(git_directory)), ports)
}

const backlogrun_restart = { restart }

export type { RestartPorts }
export { backlogrun_restart }
