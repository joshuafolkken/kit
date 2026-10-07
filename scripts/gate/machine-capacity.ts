import { readFile } from 'node:fs/promises'
import { availableParallelism, cpus, totalmem } from 'node:os'
import { execa } from 'execa'

// What the machine has free right now, read for the core budget's admission (joshuafolkken/kit#3371).
//
// **The budget used to be the core count, and that count is not what is free.** The ledger in
// `core-budget.ts` admits against `availableParallelism()`, so the load it never sees — Claude sessions,
// node processes that do not pass through `josh`, the window server — ran on top of a budget already
// spent. On 2026-10-07, three lanes on the 11-core / 18 GB machine reached a load average of 16.8 with
// 31% of the CPU in the kernel, compressing and swapping 4.4 GB of memory the ledger never counted.
//
// **This is a closed loop, not the open-loop formula joshuafolkken/kit#1637 rejected.** That proposal
// derived a share from the core count up front; this reads what is busy and free at the moment of
// admission and subtracts only the part the ledger does not already account for.
//
// **The busy cores are the CPU-time difference over a short window, not the load average.** The load
// average trails by a minute, so a gate started just after another one finished would see the finished
// one's load as external and wait out the decay. `os.cpus()` is one read with no process spawned.
//
// **A reading that fails answers undefined, and undefined is the old behavior.** A CI runner or a
// container — where the host's CPU times are not this process's quota — budgets by the core count and
// admits without looking at memory, exactly as before.

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
const LINUX_AVAILABLE = /^MemAvailable:\s+(?<kb>\d+) kB/mu
// The kernel's own memory-pressure figure: the percentage of memory still available, compressible and
// purgeable pages included — what `os.freemem()` leaves out on macOS, where it reads near zero on a
// machine with gigabytes to spare.
const PRESSURE_ARGUMENTS = ['-n', 'kern.memorystatus_level']
const PRESSURE_LEVEL = /^\s*(?<level>\d+)\s*$/u

interface MachineReading {
	busy_cores: number | undefined
	available_mb: number | undefined
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

function cpu_times(): CpuTimes {
	let busy = 0
	let idle = 0

	for (const { times } of cpus()) {
		busy += times.user + times.nice + times.sys + times.irq
		idle += times.idle
	}

	return { busy, total: busy + idle }
}

function busy_cores_between(before: CpuTimes, after: CpuTimes, cores: number): number | undefined {
	const total = after.total - before.total

	if (total <= 0) return undefined

	return ((after.busy - before.busy) / total) * cores
}

// `kern.memorystatus_level` → `58`: the share of physical memory still available, as a percentage.
function parse_darwin_pressure(output: string, total_bytes: number): number | undefined {
	const level = PRESSURE_LEVEL.exec(output)?.groups?.['level']

	if (level === undefined) return undefined

	return (Number(level) / PERCENT) * (total_bytes / BYTES_PER_MB)
}

function parse_linux_available(meminfo: string): number | undefined {
	const kb = LINUX_AVAILABLE.exec(meminfo)?.groups?.['kb']

	return kb === undefined ? undefined : Number(kb) / KB_PER_MB
}

async function read_available_mb(
	platform: NodeJS.Platform = process.platform,
): Promise<number | undefined> {
	try {
		if (platform === 'darwin') {
			const { stdout } = await execa('sysctl', PRESSURE_ARGUMENTS)

			return parse_darwin_pressure(stdout, totalmem())
		}

		return platform === 'linux'
			? parse_linux_available(await readFile(MEMINFO_PATH, 'utf8'))
			: undefined
	} catch {
		return undefined
	}
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
	const [available_mb] = await Promise.all([read_available_mb(), sleep(SAMPLE_WINDOW_MS)])
	const busy_cores = is_unquoted()
		? busy_cores_between(before, cpu_times(), cpus().length)
		: undefined

	return { busy_cores, available_mb }
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
	machine_budget,
	parse_darwin_pressure,
	parse_linux_available,
	read_machine,
}

export type { LedgerLoad, MachineBudget, MachineReading }
export { machine_capacity }
