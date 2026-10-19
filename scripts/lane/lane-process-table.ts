import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import type { PausedProbes } from './lane-paused'
import { lane_reap } from './lane-reap'
import { process_tools } from './process-tools'

// Every process on the machine at one instant, read by one asynchronous `ps`, answering the probes a
// lane's tree and its states are read through (joshuafolkken/kit#4241).
//
// **Why one snapshot.** `lane_reap`'s probes start one synchronous `ps` / `pgrep` per ancestor and per
// descendant, so a reader that asks about every lane each few seconds — `run:board`, the backlogrun
// drive — blocked its event loop for over a second with seven lanes under load. The snapshot costs one
// spawn whatever the lane and process counts, and never blocks.
//
// **The walk is not re-implemented.** `lane_reap` still walks the tree and `lane_paused` still decides;
// the snapshot only answers the questions they ask. `matching` reads the full command line the way
// `pgrep -f` does, and `-ww` keeps `ps` from cutting it at a terminal width.

const PS_ARGUMENTS = ['-A', '-ww', '-o', 'pid=,ppid=,stat=,command=']
// `ps` labels nothing locale-dependent here, but the C locale keeps its columns stable.
const PS_ENVIRONMENT = { LC_ALL: 'C' }
const FIELD_SEPARATOR = /\s+/u

interface ProcessRow {
	pid: number
	parent: number
	stat: string
	command: string
}

function is_row(row: ProcessRow): boolean {
	return Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parent) && row.command !== ''
}

// The command's own runs of white space read as one space, which no lane pattern tells apart.
function row_of(line: string): ProcessRow | undefined {
	const [pid, parent, stat = '', ...command] = line.trim().split(FIELD_SEPARATOR)
	const row = { pid: Number(pid), parent: Number(parent), stat, command: command.join(' ') }

	return is_row(row) ? row : undefined
}

/** Each `ps` line as a row; a line that does not read as one is left out. */
function parse(printed: string): Array<ProcessRow> {
	return printed
		.split('\n')
		.map((line) => row_of(line))
		.filter((row) => row !== undefined)
}

function matching_in(rows: ReadonlyArray<ProcessRow>, pattern: string): Array<number> {
	const expression = new RegExp(pattern, 'u')

	return rows.filter((row) => expression.test(row.command)).map((row) => row.pid)
}

function children_in(rows: ReadonlyArray<ProcessRow>, pid: number): Array<number> {
	return rows.filter((row) => row.parent === pid).map((row) => row.pid)
}

/** The probes a lane's tree and states are read through, answered from `rows` alone. */
function probes_of(rows: ReadonlyArray<ProcessRow>): PausedProbes {
	const by_pid = new Map(rows.map((row) => [row.pid, row]))

	return {
		matching: (pattern) => matching_in(rows, pattern),
		children_of: (pid) => children_in(rows, pid),
		parent_of: (pid) => by_pid.get(pid)?.parent,
		states_of: (pids) =>
			pids.map((pid) => by_pid.get(pid)?.stat).filter((stat) => stat !== undefined),
	}
}

/** The snapshot's probes, `undefined` where `ps` did not answer; a missing `ps` is refused by name. */
async function read(): Promise<PausedProbes | undefined> {
	try {
		const { stdout } = await execa(lane_reap.PS_COMMAND, PS_ARGUMENTS, {
			env: PS_ENVIRONMENT,
			timeout: PROBE_TIMEOUT_MS,
		})

		return probes_of(parse(stdout))
	} catch (error) {
		process_tools.throw_if_missing(lane_reap.PS_COMMAND, error)

		return undefined
	}
}

const lane_process_table = { PS_ARGUMENTS, parse, probes_of, read }

export { lane_process_table }
export type { ProcessRow }
