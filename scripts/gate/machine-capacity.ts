import { readFile } from 'node:fs/promises'
import { availableParallelism, cpus, totalmem } from 'node:os'
import { execa } from 'execa'

// What the machine has free right now, read for the core budget's admission.
//
// **The budget used to be the core count, and that count is not what is free.** The ledger in
// `core-budget.ts` admits against `availableParallelism()`, so the load it never sees — Claude sessions,
// node processes that do not pass through `josh`, the window server — ran on top of a budget already
// spent. On 2026-10-07, three lanes on the 11-core / 18 GB machine reached a load average of 16.8 with
// 31% of the CPU in the kernel, compressing and swapping 4.4 GB of memory the ledger never counted.
//
// **This is a closed loop, not an open-loop formula.** An open loop would derive a share from the
// core count up front; this reads what is busy and free at the moment of
// admission and subtracts only the part the ledger does not already account for.
//
// **The busy cores are the CPU-time difference over a short window, not the load average.** The load
// average trails by a minute, so a gate started just after another one finished would see the finished
// one's load as external and wait out the decay. `os.cpus()` is one read with no process spawned.
//
// **A reading that fails answers undefined, and undefined is the old behavior.** A CI runner or a
// container — where the host's CPU times are not this process's quota — budgets by the core count and
// admits without looking at memory, exactly as before.
//
// **`run:board` draws its machine gauges from the same reading**, so what the
// board shows a person is what the gate admits against. The board takes a sample with no window and
// draws the difference from its previous one.

// The window the busy cores are measured over: long enough that one scheduler tick does not dominate it,
// short enough that a solo admission is not visibly delayed.
const SAMPLE_WINDOW_MS = 250
// **The background a developer machine always carries, which the gate's weights were measured beside.**
// On 2026-10-07 the 11-core machine idled at about 1.5 cores outside `josh` — Claude sessions 0.55, the
// window server 0.47, a browser 0.5. The solo gate's weights sum to exactly the core count and were
// measured with that load present, so only what exceeds it is load the budget must give way to;
// counting the baseline would defer a solo gate's unit suite on every run.
const BASELINE_CORES = 2
const BYTES_PER_MB = 1_048_576
const KB_PER_MB = 1024
const PERCENT = 100
const MEMINFO_PATH = '/proc/meminfo'
const VMSTAT_PATH = '/proc/vmstat'
const LINUX_AVAILABLE = /^MemAvailable:\s+(?<kb>\d+) kB/mu
const LINUX_SWAP_IN = /^pswpin (?<pages>\d+)$/mu
const LINUX_SWAP_OUT = /^pswpout (?<pages>\d+)$/mu
const PAGE_SIZE_ARGUMENTS = ['PAGESIZE']
// The whole memory reading in one `sysctl`, cheap enough for `run:board` to take
// every second. `kern.memorystatus_level` is the kernel's own memory-pressure figure: the percentage of
// memory still available, compressible and purgeable pages included — what `os.freemem()` leaves out on
// macOS, where it reads near zero on a machine with gigabytes to spare. The swapper counters are the
// pages swapped in and out since boot, `vm_stat`'s `Swapins` / `Swapouts`. The names stay in the output
// (no `-n`), so a name an older macOS lacks drops only its own line.
const LEVEL_NAME = 'kern.memorystatus_level'
const SWAP_IN_NAME = 'vm.compressor.swapper.swapins_total'
const SWAP_OUT_NAME = 'vm.compressor.swapper.swapouts_total'
const PAGE_SIZE_NAME = 'hw.pagesize'
// The kernel's memory-pressure verdict — 1 normal, 2 warning, 4 critical — the one Activity Monitor
// colors its "memory pressure" graph by.
const PRESSURE_NAME = 'kern.memorystatus_vm_pressure_level'
const SYSCTL_ARGUMENTS = [LEVEL_NAME, SWAP_IN_NAME, SWAP_OUT_NAME, PAGE_SIZE_NAME, PRESSURE_NAME]
const SYSCTL_LINE = /^(?<name>[\w.]+): (?<value>\d+)$/gmu

interface MachineReading {
	busy_cores: number | undefined
	available_mb: number | undefined
}

// The memory half of a reading. `swapped_mb` is a counter — every page swapped in or out since boot —
// so a rate is the difference between two readings. `pressure_level` is read on macOS only.
interface MemoryReading {
	available_mb: number | undefined
	swapped_mb: number | undefined
	pressure_level: number | undefined
}

// What the ledger's admitted reservations declare — the part of the machine's load already accounted for.
interface LedgerLoad {
	cores: number
	memory_mb: number
}

interface MachineBudget {
	cores: number
	memory_mb: number
}

interface CpuTimes {
	busy: number
	total: number
}

// One moment of the machine for `run:board`: CPU times and the memory reading, no window waited out.
interface MachineSample {
	cpu: CpuTimes
	memory: MemoryReading
	total_mb: number
}

function cpu_times(): CpuTimes {
	let busy = 0
	let idle = 0

	for (const { times } of cpus()) {
		busy += times.user + times.nice + times.sys + times.irq
		idle += times.idle
	}

	return { busy, total: busy + idle }
}

// The busy share of the CPU between two readings, from 0 to 1.
function busy_share_between(before: CpuTimes, after: CpuTimes): number | undefined {
	const total = after.total - before.total

	if (total <= 0) return undefined

	return (after.busy - before.busy) / total
}

function busy_cores_between(before: CpuTimes, after: CpuTimes, cores: number): number | undefined {
	const share = busy_share_between(before, after)

	return share === undefined ? undefined : share * cores
}

function sysctl_values(output: string): Map<string, number> {
	const values = [...output.matchAll(SYSCTL_LINE)].map(
		(match) => [match.groups?.['name'] ?? '', Number(match.groups?.['value'])] as const,
	)

	return new Map(values)
}

// The pages swapped in and out since boot; either count unread leaves the sum unread.
function swapped_pages(
	pages_in: number | undefined,
	pages_out: number | undefined,
): number | undefined {
	return pages_in === undefined || pages_out === undefined ? undefined : pages_in + pages_out
}

function swapped_mb(pages: number | undefined, page_bytes: number | undefined): number | undefined {
	if (pages === undefined || page_bytes === undefined) return undefined

	return (pages * page_bytes) / BYTES_PER_MB
}

// `kern.memorystatus_level: 58` → 58% of physical memory still available, beside the swapped pages.
function parse_darwin_memory(output: string, total_bytes: number): MemoryReading {
	const values = sysctl_values(output)
	const level = values.get(LEVEL_NAME)

	return {
		available_mb:
			level === undefined ? undefined : (level / PERCENT) * (total_bytes / BYTES_PER_MB),
		swapped_mb: swapped_mb(
			swapped_pages(values.get(SWAP_IN_NAME), values.get(SWAP_OUT_NAME)),
			values.get(PAGE_SIZE_NAME),
		),
		pressure_level: values.get(PRESSURE_NAME),
	}
}

function parse_linux_available(meminfo: string): number | undefined {
	const kb = LINUX_AVAILABLE.exec(meminfo)?.groups?.['kb']

	return kb === undefined ? undefined : Number(kb) / KB_PER_MB
}

function pages_of(pattern: RegExp, vmstat: string): number | undefined {
	const pages = pattern.exec(vmstat)?.groups?.['pages']

	return pages === undefined ? undefined : Number(pages)
}

// `pswpin` and `pswpout` in `/proc/vmstat` are the pages swapped in and out since boot.
function parse_linux_swapped(vmstat: string, page_bytes: number): number | undefined {
	const pages = swapped_pages(pages_of(LINUX_SWAP_IN, vmstat), pages_of(LINUX_SWAP_OUT, vmstat))

	return swapped_mb(pages, page_bytes)
}

async function settled<T>(read: () => Promise<T>): Promise<T | undefined> {
	try {
		return await read()
	} catch {
		return undefined
	}
}

// A name `sysctl` does not know fails the command but still prints the others, so the exit is not read.
async function read_darwin_memory(): Promise<MemoryReading> {
	const { stdout } = await execa('sysctl', SYSCTL_ARGUMENTS, { reject: false })

	return parse_darwin_memory(stdout, totalmem())
}

async function read_page_size(): Promise<string> {
	const { stdout } = await execa('getconf', PAGE_SIZE_ARGUMENTS)

	return stdout
}

async function read_linux_memory(): Promise<MemoryReading> {
	const [meminfo, vmstat, page_size] = await Promise.all([
		settled(async () => await readFile(MEMINFO_PATH, 'utf8')),
		settled(async () => await readFile(VMSTAT_PATH, 'utf8')),
		settled(read_page_size),
	])
	const page_bytes = page_size === undefined ? undefined : Number(page_size)

	return {
		available_mb: meminfo === undefined ? undefined : parse_linux_available(meminfo),
		swapped_mb:
			vmstat === undefined || page_bytes === undefined
				? undefined
				: parse_linux_swapped(vmstat, page_bytes),
		pressure_level: undefined,
	}
}

const UNREAD_MEMORY: MemoryReading = {
	available_mb: undefined,
	swapped_mb: undefined,
	pressure_level: undefined,
}

async function read_memory(): Promise<MemoryReading> {
	if (process.platform === 'darwin') return (await settled(read_darwin_memory)) ?? UNREAD_MEMORY

	return process.platform === 'linux' ? await read_linux_memory() : UNREAD_MEMORY
}

// A CPU quota narrower than the host makes the host-wide CPU times the wrong machine, so the busy cores
// are read only where the quota and the host agree.
function is_unquoted(): boolean {
	return cpus().length > 0 && cpus().length === availableParallelism()
}

async function default_sleep(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms)
	})
}

async function read_machine(
	sleep: (ms: number) => Promise<void> = default_sleep,
): Promise<MachineReading> {
	const before = cpu_times()
	const [memory] = await Promise.all([read_memory(), sleep(SAMPLE_WINDOW_MS)])
	const busy_cores = is_unquoted()
		? busy_cores_between(before, cpu_times(), cpus().length)
		: undefined

	return { busy_cores, available_mb: memory.available_mb }
}

async function read_sample(): Promise<MachineSample> {
	return { cpu: cpu_times(), memory: await read_memory(), total_mb: totalmem() / BYTES_PER_MB }
}

// The busy cores the ledger does not account for, beyond the baseline the weights were measured beside,
// in whole cores — the budget is in whole cores, and a fraction of a core is not a core to give up.
function external_cores(busy_cores: number | undefined, ledger_cores: number): number {
	if (busy_cores === undefined) return 0

	return Math.floor(Math.max(0, busy_cores - ledger_cores - BASELINE_CORES))
}

// **The budget the ledger admits against: what is free plus what the ledger itself already holds.**
// The admitted reservations' load is inside the reading, and the admission walk counts their declared
// weight again, so it is added back — what is subtracted is only the load from outside the ledger. The
// caller passes every admitted claim's cores but only the memory of claims past
// `core_admission.RAMP_UP_MS`, whose tools have had time to allocate.
// Memory that could not be read is no limit at all, the behavior before memory was read.
function machine_budget(cores: number, reading: MachineReading, ledger: LedgerLoad): MachineBudget {
	return {
		cores: cores - external_cores(reading.busy_cores, ledger.cores),
		memory_mb:
			reading.available_mb === undefined ? Infinity : reading.available_mb + ledger.memory_mb,
	}
}

const machine_capacity = {
	BASELINE_CORES,
	busy_cores_between,
	busy_share_between,
	external_cores,
	machine_budget,
	parse_darwin_memory,
	parse_linux_available,
	parse_linux_swapped,
	read_machine,
	read_sample,
}

export type { CpuTimes, LedgerLoad, MachineBudget, MachineReading, MachineSample, MemoryReading }
export { machine_capacity }
