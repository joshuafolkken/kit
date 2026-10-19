import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import type { PausedProbes } from './lane-paused'
import { lane_reap } from './lane-reap'
import { process_tools } from './process-tools'

// Every process on the machine at one instant, read by one asynchronous `ps`, answering the probes a
// lane's tree and its states are read through (joshuafolkken/kit#4241), and the listing `run:board`'s
// usage columns are read from (joshuafolkken/kit#4246).
//
// **Why one snapshot.** `lane_reap`'s probes start one synchronous `ps` / `pgrep` per ancestor and per
// descendant, so a reader that asks about every lane each few seconds — `run:board`, the backlogrun
// drive — blocked its event loop for over a second with seven lanes under load. The snapshot costs one
// spawn whatever the lane and process counts, and never blocks. `run:board` takes one per refresh and
// hands it to both the lane count and the usage columns (`shared`), so the two read the same instant.
//
// **The walk is not re-implemented.** `lane_reap` still walks the tree and `lane_paused` still decides;
// the snapshot only answers the questions they ask. `matching` reads the full command line the way
// `pgrep -f` does, and `-ww` keeps `ps` from cutting it at a terminal width. The command is the full
// line rather than `comm`: `ps` cuts any column but the last, so the two cannot share one listing.

const PS_ARGUMENTS = ['-A', '-ww', '-o', 'pid=,ppid=,time=,rss=,stat=,command=']
// `ps` labels nothing locale-dependent here, but the C locale keeps its columns stable.
const PS_ENVIRONMENT = { LC_ALL: 'C' }
const FIELD_SEPARATOR = /\s+/u

interface ProcessRow {
	pid: number
	parent: number
	// `ps`'s cumulative CPU time as printed, `[DD-][HH:]MM:SS[.ss]`.
	time: string
	rss_kb: number
	stat: string
	command: string
}

// One snapshot's rows.
type ProcessTable = ReadonlyArray<ProcessRow>
// A snapshot read on demand, `undefined` where `ps` did not answer.
type TableRead = () => Promise<ProcessTable | undefined>

function is_row(row: ProcessRow): boolean {
	const { pid, parent, rss_kb, command } = row

	return Number.isSafeInteger(pid + parent) && Number.isFinite(rss_kb) && command !== ''
}

// The command's own runs of white space read as one space, which no lane pattern tells apart.
function row_of(line: string): ProcessRow | undefined {
	const [pid, parent, time = '', rss, stat = '', ...command] = line.trim().split(FIELD_SEPARATOR)
	const numbers = { pid: Number(pid), parent: Number(parent), rss_kb: Number(rss) }
	const row = { ...numbers, time, stat, command: command.join(' ') }

	return is_row(row) ? row : undefined
}

/** Each `ps` line as a row; a line that does not read as one is left out. */
function parse(printed: string): Array<ProcessRow> {
	return printed
		.split('\n')
		.map((line) => row_of(line))
		.filter((row) => row !== undefined)
}

function matching_in(rows: ProcessTable, pattern: string): Array<number> {
	const expression = new RegExp(pattern, 'u')

	return rows.filter((row) => expression.test(row.command)).map((row) => row.pid)
}

// Each parent's children, indexed once so a walk does not rescan every row per process.
function children_index(rows: ProcessTable): Map<number, Array<number>> {
	const children = new Map<number, Array<number>>()

	for (const { pid, parent } of rows) {
		const siblings = children.get(parent) ?? []

		siblings.push(pid)
		children.set(parent, siblings)
	}

	return children
}

/** The probes a lane's tree and states are read through, answered from `rows` alone. */
function probes_of(rows: ProcessTable): PausedProbes {
	const by_pid = new Map(rows.map((row) => [row.pid, row]))
	const children = children_index(rows)

	return {
		matching: (pattern) => matching_in(rows, pattern),
		children_of: (pid) => children.get(pid) ?? [],
		parent_of: (pid) => by_pid.get(pid)?.parent,
		states_of: (pids) =>
			pids.map((pid) => by_pid.get(pid)?.stat).filter((stat) => stat !== undefined),
	}
}

/** The snapshot, `undefined` where `ps` did not answer; a missing `ps` is refused by name. */
async function read_table(): Promise<ProcessTable | undefined> {
	try {
		const { stdout } = await execa(lane_reap.PS_COMMAND, PS_ARGUMENTS, {
			env: PS_ENVIRONMENT,
			timeout: PROBE_TIMEOUT_MS,
		})

		return parse(stdout)
	} catch (error) {
		process_tools.throw_if_missing(lane_reap.PS_COMMAND, error)

		return undefined
	}
}

/** The probes of `table`, `undefined` where it could not be read. */
async function probes_from(table: TableRead): Promise<PausedProbes | undefined> {
	const rows = await table()

	return rows === undefined ? undefined : probes_of(rows)
}

/** `read`, run on the first call alone; every later call answers that same snapshot. */
function shared(read: TableRead): TableRead {
	const taken: { table?: ReturnType<TableRead> } = {}

	return async function table() {
		taken.table ??= read()

		return await taken.table
	}
}

const lane_process_table = { PS_ARGUMENTS, parse, probes_from, probes_of, read_table, shared }

export { lane_process_table }
export type { ProcessRow, ProcessTable, TableRead }
