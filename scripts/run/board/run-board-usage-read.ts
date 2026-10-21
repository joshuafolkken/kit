import { cpus, totalmem } from 'node:os'
import { lane_paths } from '#scripts/lane/lane-paths'
import type { TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry } from '#scripts/lane/lane-registry'
import { process_directories } from '#scripts/lane/process-directories'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { execa } from 'execa'
import type { ProcessReading, UsageMark } from './run-board-usage'
import { run_board_usage_lanes, type DirectoryRead, type LaneLookup } from './run-board-usage-lanes'
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
// directory sits under (`.kit-lanes/<N>`), else its nearest ancestor's. A directory is looked up once
// and remembered — asked again only when an `lsof` cut short left it out — so a full `lsof` (about
// 220 ms) is paid on the first sample alone (`run-board-usage-lanes.ts`).
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

const LSOF_ARGUMENTS = [...process_directories.CWD_ARGUMENTS, '-p']
const PID_SEPARATOR = ','
const { load_builtin, rusage_reader } = run_board_usage_rusage
const { list_top, top_reader } = run_board_usage_top
const { listings_of } = run_board_usage_listing
const { lanes_for } = run_board_usage_lanes

// The working directories and the lanes root come with `LaneLookup`.
interface UsagePorts extends LaneLookup {
	// The process snapshot the lane count reads too (`lane-process-table.ts`).
	list: TableRead
	// Each process's CPU time with its reaped children's and its footprint, where `node:ffi` reaches it.
	rusage: RusageReader | undefined
	// `top`'s last memory and compressed-memory reading.
	top: () => Promise<TopReadings>
	now: () => number
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
	const lanes = await lanes_for(before, readings.parents, ports)

	return { at_ms, ...readings, ...lanes, cores: cpus().length, total_bytes: totalmem() }
}

// The answers of an `lsof` cut short, its last dropped: that one may end on a directory missing its
// tail, `.kit-lanes/43` for `.kit-lanes/4346`.
function whole_answers(directories: Map<number, string>): Map<number, string> {
	return new Map([...directories].slice(0, -1))
}

async function darwin_directories(pids: ReadonlyArray<number>): Promise<DirectoryRead> {
	// `lsof` exits non-zero when any one process is gone, and still lists the rest. One killed on its
	// budget or by a signal, or one that never started — a spawn failing under load has no exit code —
	// did not run to its end, and every process it did not answer for is asked again on the next sample
	// (`run-board-usage-lanes.ts`).
	const lsof_arguments = [...LSOF_ARGUMENTS, pids.join(PID_SEPARATOR)]
	const result = await execa('lsof', lsof_arguments, { reject: false, timeout: PROBE_TIMEOUT_MS })
	const is_cut_short = result.isTerminated || (result.failed && result.exitCode === undefined)
	const directories = process_directories.parse(result.stdout)

	if (is_cut_short) return { directories: whole_answers(directories), is_complete: false }

	return { directories, is_complete: true }
}

const PLATFORM_DIRECTORIES: Readonly<Partial<Record<NodeJS.Platform, LaneLookup['directories']>>> =
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

const run_board_usage_read = { sample, usage_reader }

export { run_board_usage_read }
export type { UsagePorts, UsageReader }
