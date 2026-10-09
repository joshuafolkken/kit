import { cpus, totalmem } from 'node:os'
import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_registry } from '#scripts/lane/lane-registry'
import { execa } from 'execa'
import type { ProcessReading, UsageMark } from './run-board-usage'
import { run_board_usage_rusage, type RusageReader } from './run-board-usage-rusage'

// How `run:board` reads which lane each process belongs to and what it uses.
// **One `ps` a second, and `lsof` only for a process not seen before.** `ps` lists every process's
// cumulative CPU time and resident memory in about 15 ms; a process is put in the lane its working
// directory sits under (`.kit-lanes/<N>`), looked up once and remembered, so a full `lsof` (about
// 220 ms) is paid on the first sample alone. The working directory rather than the parent chain: a
// process detached with `josh ship --detach` is re-parented and no longer traceable to its lane.
// **Only this repository's lanes root counts** — another repository's lane of the same number is a
// different lane. **macOS alone:** Linux's `ps` prints `time` in whole seconds, too coarse for a
// one-second difference, so there the board draws no column rather than a figure flickering to 0.
// **A process born and gone between two samples** — a vitest worker, a gate's eslint / tsc / cspell —
// is never seen by `ps`, and macOS's `ps -S` does not fold a reaped child's time into its parent's.
// Where `node:ffi` reaches the kernel's reaped-children times (`run-board-usage-rusage.ts`), each
// process's CPU time is read with them folded in and its parent is kept, so such a child lands in its
// parent's lane; elsewhere the figure stays `ps`'s own time, a lower bound.

const PS_ARGUMENTS = ['-A', '-o', 'pid=,ppid=,time=,rss=']
const LSOF_ARGUMENTS = ['-a', '-d', 'cwd', '-Fn', '-p']
const PID_SEPARATOR = ','
const PS_FIELDS = 4
const DAY_SEPARATOR = '-'
const CLOCK_SEPARATOR = ':'
const SECONDS_PER_DAY = 86_400
const SECONDS_PER_CLOCK_PART = 60
const MS_PER_SECOND = 1000
const BYTES_PER_KB = 1024
// `lsof -F`'s field lines: `p<pid>` opens a process, `n<path>` names its directory.
const LSOF_PROCESS = /^(?=p)/mu
const LSOF_NAME = 'n'
const { load_builtin, rusage_reader } = run_board_usage_rusage

// One process's line of `ps`'s listing.
interface ProcessListing {
	parent: number
	reading: ProcessReading
}

interface UsagePorts {
	// `ps`'s listing.
	list: () => Promise<string>
	// Each process's CPU time with its reaped children's, where `node:ffi` reaches it.
	rusage: RusageReader | undefined
	// The working directory of each process that answered.
	directories: (pids: ReadonlyArray<number>) => Promise<ReadonlyMap<number, string>>
	now: () => number
	// The board's own lanes root.
	root: string
}

// `ps`'s `time`, `[DD-][HH:]MM:SS[.ss]`, in milliseconds.
function cpu_ms_of(text: string): number {
	const [days, clock = ''] = text.includes(DAY_SEPARATOR) ? text.split(DAY_SEPARATOR) : ['0', text]
	const seconds = clock
		.split(CLOCK_SEPARATOR)
		.reduce((sum, part) => sum * SECONDS_PER_CLOCK_PART + Number(part), 0)

	return (Number(days) * SECONDS_PER_DAY + seconds) * MS_PER_SECOND
}

function listing_of(line: string): [number, ProcessListing] | undefined {
	const fields = line.trim().split(/\s+/u)
	const [pid, parent, time = '', rss] = fields
	const reading = { cpu_ms: cpu_ms_of(time), rss_bytes: Number(rss) * BYTES_PER_KB }
	const is_number = !Number.isNaN(reading.cpu_ms + reading.rss_bytes + Number(parent))

	if (!is_number || fields.length !== PS_FIELDS) return undefined

	return [Number(pid), { parent: Number(parent), reading }]
}

function parse_ps(output: string): Map<number, ProcessListing> {
	const listings = output.split('\n').map((line) => listing_of(line))

	return new Map(listings.filter((listing) => listing !== undefined))
}

// A process whose read failed keeps the larger of `ps`'s own time and its last reading: once reaped,
// its whole folded count lands in its parent's, so what comes off there has to be that count — its own
// time alone would count its reaped children a second time.
function folded_reading(
	reading: ProcessReading,
	cpu_ms: number | undefined,
	earlier: ProcessReading | undefined,
): ProcessReading {
	if (cpu_ms !== undefined) return { ...reading, cpu_ms }

	return { ...reading, cpu_ms: Math.max(reading.cpu_ms, earlier?.cpu_ms ?? 0) }
}

type Readings = Pick<UsageMark, 'folded' | 'parents' | 'processes'>

function own_readings(listings: ReadonlyMap<number, ProcessListing>): Readings {
	const processes = new Map([...listings].map(([pid, { reading }]) => [pid, reading] as const))

	return { processes, parents: new Map(), folded: new Set() }
}

// `ps`'s own-time readings, each replaced by its reaped-children-folded time where `rusage` reads one.
// Every process keeps its parent once there is a reader: one whose own read failed — gone by then, or
// another user's — still lands in its parent's count when reaped, so what was counted for it comes off.
function readings_of(
	listings: ReadonlyMap<number, ProcessListing>,
	rusage: RusageReader | undefined,
	earlier: ReadonlyMap<number, ProcessReading> = new Map(),
): Readings {
	if (rusage === undefined) return own_readings(listings)

	const processes = new Map<number, ProcessReading>()
	const folded = new Set<number>()
	const parents = new Map([...listings].map(([pid, { parent }]) => [pid, parent] as const))

	for (const [pid, { reading }] of listings) {
		const cpu_ms = rusage(pid)

		processes.set(pid, folded_reading(reading, cpu_ms, earlier.get(pid)))
		if (cpu_ms !== undefined) folded.add(pid)
	}

	return { processes, parents, folded }
}

function lsof_block(block: string): [number, string] | undefined {
	const [process_line = '', ...rest] = block.trim().split('\n')
	const name = rest.find((line) => line.startsWith(LSOF_NAME))

	return name === undefined ? undefined : [Number(process_line.slice(1)), name.slice(1)]
}

function parse_lsof(output: string): Map<number, string> {
	const blocks = output.split(LSOF_PROCESS).map((block) => lsof_block(block))

	return new Map(blocks.filter((block) => block !== undefined))
}

// The lane of `root` a directory sits under — itself or a directory above it, the outermost first.
function lane_of(directory: string, root: string): string | undefined {
	const parts = directory.split(path.sep)
	const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join(path.sep)).slice(1)
	const environment = { [lane_paths.LANE_ROOT_KEY]: root }

	return ancestors.map((ancestor) => lane_paths.lane_issue_of(ancestor, environment)).find(Boolean)
}

function directory_lane(directory: string | undefined, root: string): string | undefined {
	return directory === undefined ? undefined : lane_of(directory, root)
}

// The lanes of the processes still listed: a gone one dropped, and one not seen before looked up.
async function lanes_for(
	known: ReadonlyMap<number, string | undefined>,
	processes: ReadonlyMap<number, ProcessReading>,
	ports: UsagePorts,
): Promise<Map<number, string | undefined>> {
	const kept = new Map([...known].filter(([pid]) => processes.has(pid)))
	const fresh = [...processes.keys()].filter((pid) => !kept.has(pid))

	if (fresh.length === 0) return kept

	const directories = await ports.directories(fresh)
	const found = fresh.map((pid) => [pid, directory_lane(directories.get(pid), ports.root)] as const)

	return new Map([...kept, ...found])
}

async function sample(before: UsageMark | undefined, ports: UsagePorts): Promise<UsageMark> {
	const at_ms = ports.now()
	const readings = readings_of(parse_ps(await ports.list()), ports.rusage, before?.processes)
	const lanes = await lanes_for(before?.lanes ?? new Map(), readings.processes, ports)

	return { at_ms, ...readings, lanes, cores: cpus().length, total_bytes: totalmem() }
}

async function darwin_directories(
	pids: ReadonlyArray<number>,
): Promise<ReadonlyMap<number, string>> {
	// `lsof` exits non-zero when any one process is gone, and still lists the rest.
	const lsof_arguments = [...LSOF_ARGUMENTS, pids.join(PID_SEPARATOR)]
	const { stdout } = await execa('lsof', lsof_arguments, { reject: false })

	return parse_lsof(stdout)
}

const PLATFORM_DIRECTORIES: Readonly<Partial<Record<NodeJS.Platform, UsagePorts['directories']>>> =
	{ darwin: darwin_directories }

async function list_live(): Promise<string> {
	const { stdout } = await execa('ps', PS_ARGUMENTS)

	return stdout
}

async function board_lane_root(): Promise<string> {
	return lane_paths.lane_root(await lane_registry.main_repository_root())
}

// What one board's reader resolves once and keeps, since neither moves while the board is open.
interface ReaderSetup {
	root: Promise<string>
	rusage: RusageReader | undefined
}

// `undefined` where the processes cannot be read — no `ps`, no way to a working directory, no
// repository — so the board draws no column rather than failing.
async function read_usage(
	before: UsageMark | undefined,
	setup: ReaderSetup,
	platform: NodeJS.Platform,
): Promise<UsageMark | undefined> {
	const directories = PLATFORM_DIRECTORIES[platform]

	if (directories === undefined) return undefined

	try {
		const { rusage } = setup
		const ports = { list: list_live, rusage, directories, now: Date.now, root: await setup.root }

		return await sample(before, ports)
	} catch {
		return undefined
	}
}

// One board's reader: the `node:ffi` reader is opened with it, and the lanes root resolved on the first
// sample.
function usage_reader(
	platform: NodeJS.Platform = process.platform,
): (before: UsageMark | undefined) => Promise<UsageMark | undefined> {
	const rusage = rusage_reader(platform, load_builtin)
	const resolved: { root?: Promise<string> } = {}

	async function read(before: UsageMark | undefined): Promise<UsageMark | undefined> {
		resolved.root ??= board_lane_root()

		return await read_usage(before, { root: resolved.root, rusage }, platform)
	}

	return read
}

const run_board_usage_read = { lane_of, parse_lsof, parse_ps, sample, usage_reader }

export { run_board_usage_read }
export type { UsagePorts }
