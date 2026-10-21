import { readFile } from 'node:fs/promises'
import { availableParallelism, cpus, loadavg, totalmem } from 'node:os'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
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
// board shows a person is what the gate admits against — the gate reading the free memory as none
// while the board's pressure and swap gauges show why. The board takes a sample with no window and
// draws the difference from its previous one. `lane:sample` records the memory half of it, so the
// lane-limit measurement sets the same figures beside the lane count.

// The window the busy cores are measured over: long enough that one scheduler tick does not dominate it,
// short enough that a solo admission is not visibly delayed.
const SAMPLE_WINDOW_MS = 250
// **Run-queue load outside the ledger past this many times the cores holds the first waiter too**
// (joshuafolkken/kit#4361). The first waiter ignores outside load (joshuafolkken/kit#4313), and lanes took
// the 11-core machine to a load average of 25–34. Twice the cores is loose on purpose: the one-core
// editor load #4313 stopped holding a solo gate stays far below it, so neither its starvation nor the
// lanes' speed comes back, while a machine whose queue beyond the ledger passes two per core waits.
const OVERLOAD_FACTOR = 2
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
// pages swapped in and out since boot, `vm_stat`'s `Swapins` / `Swapouts`; `vm.compressor_input_bytes` is
// the bytes the compressor has taken in since boot, `vm_stat`'s `Compressions`. The names stay in the output
// (no `-n`), so a name an older macOS lacks drops only its own line.
const LEVEL_NAME = 'kern.memorystatus_level'
const SWAP_IN_NAME = 'vm.compressor.swapper.swapins_total'
const SWAP_OUT_NAME = 'vm.compressor.swapper.swapouts_total'
const COMPRESSED_NAME = 'vm.compressor_input_bytes'
const PAGE_SIZE_NAME = 'hw.pagesize'
// The kernel's memory-pressure verdict — 1 normal, 2 warning, 4 critical — the one Activity Monitor
// colors its "memory pressure" graph by.
const PRESSURE_NAME = 'kern.memorystatus_vm_pressure_level'
// **Only critical holds; warning is sticky** (joshuafolkken/kit#4199). On macOS the verdict can stay at
// warning for hours after the pressure passed, so a hold on warning never lifts. What is pressured right
// now shows in the free figure and the swap and compressor traffic; the verdict adds only critical.
const PRESSURE_HOLD = 4
// The swap traffic across one window that reads as pressure — 64 MB a second paged to disk. A machine
// that swapped once still pages a few megabytes back in as old pages are touched.
const SWAP_PRESSURE_MB = 16
// The compressor traffic across one window that reads as pressure. An idle machine compresses nothing
// across a window; the 2026-10-16 thrash compressed about 240,000 16 KB pages every three seconds, about
// 310 MB a window, with no swap figure to show for it.
const COMPRESSION_PRESSURE_MB = 64
const SYSCTL_ARGUMENTS = [
	LEVEL_NAME,
	SWAP_IN_NAME,
	SWAP_OUT_NAME,
	COMPRESSED_NAME,
	PAGE_SIZE_NAME,
	PRESSURE_NAME,
]
const SYSCTL_LINE = /^(?<name>[\w.]+): (?<value>\d+)$/gmu

// `memory_pressured` says why `available_mb` read none, so a claim that waits can name the pressure.
// `run_queue` is the one-minute load average: the busy cores stop at the core count, so only the queue
// tells a machine at twice its cores from one at once (`is_overloaded`).
interface MachineReading {
	busy_cores: number | undefined
	available_mb: number | undefined
	memory_pressured?: boolean | undefined
	run_queue?: number | undefined
}

// The memory half of a reading. `swapped_mb` is a counter — every page swapped in or out since boot —
// so a rate is the difference between two readings, and so is `compressed_mb`, every byte compressed
// since boot. `pressure_level` and `compressed_mb` are read on macOS only.
interface MemoryReading {
	available_mb: number | undefined
	swapped_mb: number | undefined
	pressure_level: number | undefined
	compressed_mb?: number | undefined
}

// What the ledger's admitted reservations declare — the part of the machine's load already accounted for.
interface LedgerLoad {
	cores: number
	memory_mb: number
}

// `busy_excess` is the measured cores beyond what the ledger declares — what `cores` gave up to load the
// ledger does not hold, so a claim that waits on it can name the CPU as saturated. `is_overloaded` lifts
// the first waiter's exemption from that load (`core_admission.is_admitted`).
interface MachineBudget {
	cores: number
	memory_mb: number
	memory_pressured?: boolean | undefined
	busy_excess?: number | undefined
	is_overloaded?: boolean | undefined
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

function mb_of(units: number | undefined, unit_bytes: number | undefined): number | undefined {
	if (units === undefined || unit_bytes === undefined) return undefined

	return (units * unit_bytes) / BYTES_PER_MB
}

// What was swapped between two readings of the counter. A counter that went back — a reboot between
// them — is read as nothing swapped.
function swapped_between(from: number | undefined, to: number | undefined): number | undefined {
	if (from === undefined || to === undefined) return undefined

	return Math.max(0, to - from)
}

// `kern.memorystatus_level: 58` → 58% of physical memory still available, beside the swapped pages.
function parse_darwin_memory(output: string, total_bytes: number): MemoryReading {
	const values = sysctl_values(output)
	const level = values.get(LEVEL_NAME)

	return {
		available_mb:
			level === undefined ? undefined : (level / PERCENT) * (total_bytes / BYTES_PER_MB),
		swapped_mb: mb_of(
			swapped_pages(values.get(SWAP_IN_NAME), values.get(SWAP_OUT_NAME)),
			values.get(PAGE_SIZE_NAME),
		),
		pressure_level: values.get(PRESSURE_NAME),
		compressed_mb: mb_of(values.get(COMPRESSED_NAME), 1),
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

	return mb_of(pages, page_bytes)
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
	const { stdout } = await execa('sysctl', SYSCTL_ARGUMENTS, {
		reject: false,
		timeout: PROBE_TIMEOUT_MS,
	})

	return parse_darwin_memory(stdout, totalmem())
}

async function read_page_size(): Promise<string> {
	const { stdout } = await execa('getconf', PAGE_SIZE_ARGUMENTS, { timeout: PROBE_TIMEOUT_MS })

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

// Whether a counter gained more than `limit` MB across the window; an unread counter gained nothing.
function moved_over(from: number | undefined, to: number | undefined, limit: number): boolean {
	return (swapped_between(from, to) ?? 0) > limit
}

function is_pressured(before: MemoryReading, after: MemoryReading): boolean {
	return (
		(after.pressure_level ?? 0) >= PRESSURE_HOLD ||
		moved_over(before.swapped_mb, after.swapped_mb, SWAP_PRESSURE_MB) ||
		moved_over(before.compressed_mb, after.compressed_mb, COMPRESSION_PRESSURE_MB)
	)
}

// **Only a reading the kernel calls critical has nothing free to admit against.** Swap and compressor
// traffic across the window used to answer no free memory too (joshuafolkken/kit#3943), but this machine
// swaps out 0.4–1.3 TB a day as a matter of course, so that traffic held about a third of every wait
// with memory to spare (joshuafolkken/kit#4313). A claim now waits on memory only when the free figure
// falls short of what it declares; the traffic still names the wait as pressure (`memory_pressured`).
function pressured_available(after: MemoryReading): number | undefined {
	if (after.available_mb === undefined) return undefined

	return (after.pressure_level ?? 0) >= PRESSURE_HOLD ? 0 : after.available_mb
}

// Memory is read at both ends of the window, so the swap counter's difference is the activity during it.
async function read_machine(
	sleep: (ms: number) => Promise<void> = default_sleep,
): Promise<MachineReading> {
	const before = cpu_times()
	const [memory_before] = await Promise.all([read_memory(), sleep(SAMPLE_WINDOW_MS)])
	const memory_after = await read_memory()
	const is_host = is_unquoted()
	const busy_cores = is_host ? busy_cores_between(before, cpu_times(), cpus().length) : undefined

	return {
		busy_cores,
		run_queue: is_host ? loadavg()[0] : undefined,
		available_mb: pressured_available(memory_after),
		memory_pressured: is_pressured(memory_before, memory_after),
	}
}

async function read_sample(): Promise<MachineSample> {
	return { cpu: cpu_times(), memory: await read_memory(), total_mb: totalmem() / BYTES_PER_MB }
}

// The busy cores the ledger does not account for, in whole cores — the budget is in whole cores, and a
// fraction of a core is not a core to give up.
//
// **Every busy core counts, the background included** (joshuafolkken/kit#4238). A baseline of two cores
// used to be exempt, so with 10 cores reserved and all 11 busy the reading saw no excess and admitted
// another claim onto a saturated CPU.
function external_cores(busy_cores: number | undefined, ledger_cores: number): number {
	if (busy_cores === undefined) return 0

	return Math.floor(Math.max(0, busy_cores - ledger_cores))
}

// The run queue beyond what the ledger declares, past `OVERLOAD_FACTOR` times the cores. The ledger's own
// claims running past their weight count as outside load. The load average trails by a minute, so a
// first waiter held here waits out the decay — only at a load already this far past the machine. A queue
// that could not be read, and Windows' constant zero, never hold.
function is_overloaded(
	run_queue: number | undefined,
	ledger_cores: number,
	cores: number,
): boolean {
	if (run_queue === undefined) return false

	return run_queue - ledger_cores > cores * OVERLOAD_FACTOR
}

// **The budget the ledger admits against: `cores − max(ledger, busy)` free, plus what the ledger itself
// already holds.** The admission walk counts the ledger's declared weight again, so it is added back —
// what is subtracted is only the busy load beyond it. A claim admitted moments ago is not busy yet, and
// the ledger's declared cores cover it. The caller passes every admitted claim's cores but only the
// memory of claims past `core_admission.RAMP_UP_MS`, whose tools have had time to allocate.
// Memory that could not be read is no limit at all, the behavior before memory was read.
function machine_budget(cores: number, reading: MachineReading, ledger: LedgerLoad): MachineBudget {
	const busy_excess = external_cores(reading.busy_cores, ledger.cores)

	return {
		cores: Math.max(0, cores - busy_excess),
		memory_mb:
			reading.available_mb === undefined ? Infinity : reading.available_mb + ledger.memory_mb,
		memory_pressured: reading.memory_pressured,
		busy_excess,
		is_overloaded: is_overloaded(reading.run_queue, ledger.cores, cores),
	}
}

const machine_capacity = {
	busy_cores_between,
	busy_share_between,
	COMPRESSION_PRESSURE_MB,
	external_cores,
	machine_budget,
	parse_darwin_memory,
	parse_linux_available,
	parse_linux_swapped,
	PRESSURE_HOLD,
	pressured_available,
	read_machine,
	read_memory,
	read_sample,
	SWAP_PRESSURE_MB,
	swapped_between,
}

export type { CpuTimes, LedgerLoad, MachineBudget, MachineReading, MachineSample, MemoryReading }
export { machine_capacity }
