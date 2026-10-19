import { process_identity } from '#scripts/josh/process-identity'
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
//
// **The start time is `process_identity`'s own reading.** A detached ship's record names its process by
// start time (`run-ship-detach.ts`), and the `lstart` column under `process_identity`'s environment
// prints it exactly as that module's own `ps` does, so a ship is told alive from these rows without
// starting another `ps` (joshuafolkken/kit#4245).

const COLUMNS = ['pid=', 'ppid=', 'time=', 'rss=', 'stat=', process_identity.START_TIME_FORMAT]
const PS_ARGUMENTS = ['-A', '-ww', '-o', [...COLUMNS, 'command='].join(',')]
// `ps` labels nothing locale-dependent here, and the C locale keeps its columns stable; the time zone
// fixes how the start time prints.
const PS_ENVIRONMENT = process_identity.PROBE_ENVIRONMENT
const FIELD_SEPARATOR = /\s+/u
// `lstart` prints `Tue Sep  8 08:39:04 2026`: five fields, the day of the month padded to two places.
const START_FIELDS = 5
const DAY_FIELD = 2
const DAY_WIDTH = 2

interface ProcessRow {
	pid: number
	parent: number
	// `ps`'s cumulative CPU time as printed, `[DD-][HH:]MM:SS[.ss]`.
	time: string
	rss_kb: number
	stat: string
	// The start time as `process_identity`'s `ps` prints it.
	start: string
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

// The split fields put back with the day's padding the split dropped.
function start_of(fields: ReadonlyArray<string>): string {
	return fields
		.map((field, index) => (index === DAY_FIELD ? field.padStart(DAY_WIDTH) : field))
		.join(' ')
}

// The command's own runs of white space read as one space, which no lane pattern tells apart.
function row_of(line: string): ProcessRow | undefined {
	const [pid, parent, time = '', rss, stat = '', ...rest] = line.trim().split(FIELD_SEPARATOR)
	const numbers = { pid: Number(pid), parent: Number(parent), rss_kb: Number(rss) }
	const start = start_of(rest.slice(0, START_FIELDS))
	const row = { ...numbers, time, stat, start, command: rest.slice(START_FIELDS).join(' ') }

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

/** `process_identity.read_start` with its `ps` answered from `rows`: `/proc` first, as there. */
function start_reader(rows: ProcessTable): (pid: number) => string | undefined {
	const starts = new Map(rows.map((row) => [row.pid, row.start]))
	const probes = {
		...process_identity.START_PROBES,
		read_ps_start: (pid: number) => starts.get(pid),
	}

	return (pid) => process_identity.read_start(pid, probes)
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

const lane_process_table = {
	PS_ARGUMENTS,
	parse,
	probes_from,
	probes_of,
	read_table,
	shared,
	start_reader,
}

export { lane_process_table }
export type { ProcessRow, ProcessTable, TableRead }
