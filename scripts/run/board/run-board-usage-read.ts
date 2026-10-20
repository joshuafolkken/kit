import { cpus, totalmem } from 'node:os'
import path from 'node:path'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import type { ProcessReading, UsageMark } from './run-board-usage'
import { run_board_usage_listing, type ProcessListing } from './run-board-usage-listing'
import {
	run_board_usage_rusage,
	type RusageReader,
	type RusageReading,
} from './run-board-usage-rusage'
import { run_board_usage_top, type TopReading, type TopReadings } from './run-board-usage-top'

// How `run:board` reads which lane each process belongs to and what it uses.
// **One `ps` a second, and `lsof` only for a process not seen before.** `ps` — the snapshot the lane
// count reads in the same refresh (`lane-process-table.ts`), never one of its own — lists every process's
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
// **Memory is `top`'s MEM, compressed memory its CMPRS** — the footprint `node:ffi` reads each second
// where it can, else `top`'s last reading (`run-board-usage-top.ts`, at most once every 30 s), else
// `ps`'s resident set; compressed memory only `top` has, so it is 0 until `top` has answered.

const LSOF_ARGUMENTS = ['-a', '-d', 'cwd', '-Fn', '-p']
const PID_SEPARATOR = ','
// `lsof -F`'s field lines: `p<pid>` opens a process, `n<path>` names its directory.
const LSOF_PROCESS = /^(?=p)/mu
const LSOF_NAME = 'n'
const { load_builtin, rusage_reader } = run_board_usage_rusage
const { list_top, top_reader } = run_board_usage_top
const { listings_of } = run_board_usage_listing

interface UsagePorts {
	// The process snapshot the lane count reads too (`lane-process-table.ts`).
	list: TableRead
	// Each process's CPU time with its reaped children's and its footprint, where `node:ffi` reaches it.
	rusage: RusageReader | undefined
	// `top`'s last memory and compressed-memory reading.
	top: () => Promise<TopReadings>
	// The working directory of each process that answered.
	directories: (pids: ReadonlyArray<number>) => Promise<ReadonlyMap<number, string>>
	now: () => number
	// The board's own lanes root.
	root: string
}

// What one reading is made from: `ps`'s line, `node:ffi`'s reading and `top`'s — `ps`'s resident set
// and no compressed memory standing in for a process `top` has not listed.
interface ReadingSources {
	listing: ProcessListing
	rusage: RusageReading | undefined
	top: TopReading
	earlier: ProcessReading | undefined
}

function top_of(top: TopReadings, pid: number, listing: ProcessListing): TopReading {
	return top.get(pid) ?? { memory_bytes: listing.rss_bytes, compressed_bytes: 0 }
}

// A process whose `node:ffi` read failed keeps the larger of `ps`'s own time and its last reading: once
// reaped, its whole folded count lands in its parent's, so what comes off there has to be that count —
// its own time alone would count its reaped children a second time.
function cpu_ms_from({ listing, rusage, earlier }: ReadingSources): number {
	if (rusage !== undefined) return rusage.cpu_ms

	return Math.max(listing.cpu_ms, earlier?.cpu_ms ?? 0)
}

function reading_of(sources: ReadingSources): ProcessReading {
	const { rusage, top } = sources
	const memory_bytes = rusage?.footprint_bytes ?? top.memory_bytes

	return { cpu_ms: cpu_ms_from(sources), memory_bytes, compressed_bytes: top.compressed_bytes }
}

type Readings = Pick<UsageMark, 'folded' | 'names' | 'parents' | 'processes'>

// What the readings are made from besides `ps`'s listing.
interface ReadingInputs {
	rusage: RusageReader | undefined
	top: TopReadings
	earlier: ReadonlyMap<number, ProcessReading>
}

// `ps`'s own-time readings, each replaced by its reaped-children-folded time where `rusage` reads one;
// `ps` alone counts no reaped child, so nothing is folded there. Every process keeps its parent: one
// whose own read failed — gone by then, or another user's — still lands in its parent's count when
// reaped, so what was counted for it comes off.
function readings_of(
	listings: ReadonlyMap<number, ProcessListing>,
	inputs: ReadingInputs,
): Readings {
	const processes = new Map<number, ProcessReading>()
	const folded = new Set<number>()

	for (const [pid, listing] of listings) {
		const rusage = inputs.rusage?.(pid)
		const top = top_of(inputs.top, pid, listing)

		processes.set(pid, reading_of({ listing, rusage, top, earlier: inputs.earlier.get(pid) }))
		if (rusage !== undefined) folded.add(pid)
	}

	const parents = new Map([...listings].map(([pid, { parent }]) => [pid, parent] as const))
	const names = new Map([...listings].map(([pid, { command }]) => [pid, command] as const))

	return { processes, parents, names, folded }
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

// The snapshot's listings and `top`'s reading, read together; a snapshot `ps` did not answer fails the
// sample.
async function listed_of(
	ports: UsagePorts,
): Promise<{ listed: Map<number, ProcessListing>; top: TopReadings }> {
	const [table, top] = await Promise.all([ports.list(), ports.top()])

	if (table === undefined) throw new Error('ps did not answer')

	return { listed: listings_of(table), top }
}

async function sample(before: UsageMark | undefined, ports: UsagePorts): Promise<UsageMark> {
	const at_ms = ports.now()
	const { listed, top } = await listed_of(ports)
	const earlier = before?.processes ?? new Map()
	const readings = readings_of(listed, { rusage: ports.rusage, top, earlier })
	const lanes = await lanes_for(before?.lanes ?? new Map(), readings.processes, ports)

	return { at_ms, ...readings, lanes, cores: cpus().length, total_bytes: totalmem() }
}

async function darwin_directories(
	pids: ReadonlyArray<number>,
): Promise<ReadonlyMap<number, string>> {
	// `lsof` exits non-zero when any one process is gone, and still lists the rest. A budget kill is
	// not that: it lists nothing, and `lanes_for` never asks again about a process it read as being in
	// no lane, so the sample fails instead of pinning every live process to none.
	const lsof_arguments = [...LSOF_ARGUMENTS, pids.join(PID_SEPARATOR)]
	const result = await execa('lsof', lsof_arguments, { reject: false, timeout: PROBE_TIMEOUT_MS })

	if (result.timedOut) throw new Error('lsof timed out')

	return parse_lsof(result.stdout)
}

const PLATFORM_DIRECTORIES: Readonly<Partial<Record<NodeJS.Platform, UsagePorts['directories']>>> =
	{ darwin: darwin_directories }

async function board_lane_root(): Promise<string> {
	return lane_paths.lane_root(await lane_registry.main_repository_root())
}

// What one reading is taken through: the board's snapshot, and what its reader resolves once and keeps,
// since none of those moves while the board is open.
interface ReaderSetup {
	list: TableRead
	root: Promise<string>
	rusage: RusageReader | undefined
	top: UsagePorts['top']
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
		const { list, rusage, top } = setup
		const root = await setup.root

		return await sample(before, { list, rusage, top, directories, now: Date.now, root })
	} catch {
		return undefined
	}
}

type UsageReader = (
	before: UsageMark | undefined,
	table: TableRead,
) => Promise<UsageMark | undefined>

// One board's reader: the `node:ffi` and `top` readers are opened with it, and the lanes root resolved
// on the first sample. Each reading takes the refresh's snapshot rather than a `ps` of its own.
function usage_reader(platform: NodeJS.Platform = process.platform): UsageReader {
	const rusage = rusage_reader(platform, load_builtin)
	const top = top_reader({ list: list_top, now: Date.now })
	const resolved: { root?: Promise<string> } = {}

	async function read(
		before: UsageMark | undefined,
		table: TableRead,
	): Promise<UsageMark | undefined> {
		resolved.root ??= board_lane_root()

		return await read_usage(before, { list: table, root: resolved.root, rusage, top }, platform)
	}

	return read
}

const run_board_usage_read = { lane_of, parse_lsof, sample, usage_reader }

export { run_board_usage_read }
export type { UsagePorts, UsageReader }
