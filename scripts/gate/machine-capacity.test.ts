import { hanging_execa } from '#tools/test/hanging-execa'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { core_admission, type LedgerEntry } from './core-admission'
import { machine_capacity, type MachineReading, type MemoryReading } from './machine-capacity'

vi.mock('execa', async () => {
	const { hanging_execa: stand_in } = await import('#tools/test/hanging-execa')

	return { execa: stand_in.spawn }
})

afterEach(() => {
	hanging_execa.reset()
	vi.restoreAllMocks()
})

// joshuafolkken/kit#3371: the core budget admitted against the core count whatever else the machine
// was running, so three lanes reached a load average of 16.8 on 11 cores and swapped memory nobody
// counted. The budget is now what the machine has free, less only the load outside the ledger.

const CORES = 11
const NO_LEDGER = { cores: 0, memory_mb: 0 }
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const EIGHTEEN_GB = 18 * 1024 * 1024 * 1024
const AVAILABLE_MB = 4000
const LEDGER_MEMORY_MB = 2400
const LEDGER_CORES = 4
const PAGE_BYTES = 4096
// 256 + 512 pages of 4 KB: 3 MB swapped since boot; 5 MB compressed since boot.
const DARWIN_LEVEL = 'kern.memorystatus_level: 58'
const DARWIN_SYSCTL = [
	DARWIN_LEVEL,
	'vm.compressor.swapper.swapins_total: 256',
	'vm.compressor.swapper.swapouts_total: 512',
	'vm.compressor_input_bytes: 5242880',
	`hw.pagesize: ${String(PAGE_BYTES)}`,
].join('\n')

describe('machine_capacity.machine_budget — the budget the ledger admits against', () => {
	it('is the core count when nothing outside the ledger is busy', () => {
		const reading = { busy_cores: LEDGER_CORES, available_mb: AVAILABLE_MB }
		const ledger = { cores: LEDGER_CORES, memory_mb: 0 }

		expect(machine_capacity.machine_budget(CORES, reading, ledger).cores).toBe(CORES)
	})

	it('gives way to every busy core outside the ledger, the background included', () => {
		const external = 5
		const reading = { busy_cores: external, available_mb: AVAILABLE_MB }

		expect(machine_capacity.machine_budget(CORES, reading, NO_LEDGER).cores).toBe(CORES - external)
	})

	it('adds back the memory the admitted ledger already holds', () => {
		const reading = { busy_cores: 0, available_mb: AVAILABLE_MB }
		const ledger = { cores: 0, memory_mb: LEDGER_MEMORY_MB }

		expect(machine_capacity.machine_budget(CORES, reading, ledger).memory_mb).toBe(
			AVAILABLE_MB + LEDGER_MEMORY_MB,
		)
	})

	it('falls back to the core count and no memory limit when nothing could be read', () => {
		expect(machine_capacity.machine_budget(CORES, UNREAD, NO_LEDGER)).toEqual({
			cores: CORES,
			memory_mb: Infinity,
			busy_excess: 0,
		})
	})
})

// joshuafolkken/kit#4238: 10 cores reserved and all 11 busy read as no excess under the old two-core
// baseline, so the next claim was admitted onto a saturated CPU.
describe('machine_capacity.machine_budget — a CPU busier than the ledger declares', () => {
	it('leaves no room past the ledger when every core is busy', () => {
		const ledger_cores = 10
		const reading = { busy_cores: CORES, available_mb: undefined }
		const budget = machine_capacity.machine_budget(CORES, reading, {
			cores: ledger_cores,
			memory_mb: 0,
		})

		expect(budget).toMatchObject({ cores: ledger_cores, busy_excess: 1 })
	})

	it('is never below zero when outside load passes the core count', () => {
		const reading = { busy_cores: CORES + LEDGER_CORES, available_mb: undefined }

		expect(machine_capacity.machine_budget(CORES, reading, NO_LEDGER).cores).toBe(0)
	})
})

describe('machine_capacity.busy_cores_between', () => {
	it('scales the busy share of the window to cores', () => {
		const before = { busy: 0, total: 0 }
		const after = { busy: 50, total: 100 }
		const half = 0.5

		expect(machine_capacity.busy_cores_between(before, after, CORES)).toBe(CORES * half)
	})

	it('answers undefined for a window with no elapsed CPU time', () => {
		const times = { busy: 1, total: 1 }

		expect(machine_capacity.busy_cores_between(times, times, CORES)).toBeUndefined()
	})
})

// joshuafolkken/kit#3452: the verdict Activity Monitor colors its memory pressure graph by.
describe('machine_capacity memory pressure', () => {
	it('reads the kernel memory pressure verdict', () => {
		const warning = 2
		const output = `${DARWIN_SYSCTL}\nkern.memorystatus_vm_pressure_level: ${String(warning)}`

		expect(machine_capacity.parse_darwin_memory(output, EIGHTEEN_GB).pressure_level).toBe(warning)
	})
})

describe('machine_capacity memory readers', () => {
	// joshuafolkken/kit#3450: one `sysctl` carries the pressure level and the swap counters.
	it('reads the macOS pressure level and the pages swapped from one sysctl output', () => {
		const level = 58
		const total_mb = EIGHTEEN_GB / (1024 * 1024)
		const reading = machine_capacity.parse_darwin_memory(DARWIN_SYSCTL, EIGHTEEN_GB)

		expect(reading.available_mb).toBeCloseTo((total_mb * level) / 100)
		expect(reading.swapped_mb).toBe(3)
		expect(reading.compressed_mb).toBe(5)
	})

	it('leaves a figure unread when its sysctl name is missing', () => {
		const level_only = machine_capacity.parse_darwin_memory(DARWIN_LEVEL, EIGHTEEN_GB)

		expect(level_only.swapped_mb).toBeUndefined()
		expect(level_only.pressure_level).toBeUndefined()
		expect(machine_capacity.parse_darwin_memory('', EIGHTEEN_GB)).toStrictEqual({
			available_mb: undefined,
			swapped_mb: undefined,
			pressure_level: undefined,
			compressed_mb: undefined,
		})
	})

	it('reads the pages swapped from /proc/vmstat in MB', () => {
		const vmstat = 'nr_free_pages 10\npswpin 256\npswpout 512\n'

		expect(machine_capacity.parse_linux_swapped(vmstat, PAGE_BYTES)).toBe(3)
		expect(machine_capacity.parse_linux_swapped('pswpin 256\n', PAGE_BYTES)).toBeUndefined()
	})

	it('reads MemAvailable from /proc/meminfo in MB', () => {
		const meminfo = 'MemTotal:       16384000 kB\nMemAvailable:    4096000 kB\n'

		expect(machine_capacity.parse_linux_available(meminfo)).toBe(4000)
	})

	it('answers undefined when MemAvailable is absent', () => {
		expect(machine_capacity.parse_linux_available('MemTotal: 1 kB\n')).toBeUndefined()
	})
})

// joshuafolkken/kit#3593: `run:board` and `lane:stats` read the swap counter's difference from one place.
describe('machine_capacity.swapped_between', () => {
	it('answers what the counter gained between two readings', () => {
		expect(machine_capacity.swapped_between(AVAILABLE_MB, AVAILABLE_MB + 1)).toBe(1)
	})

	it('reads a counter that went back as nothing swapped', () => {
		expect(machine_capacity.swapped_between(AVAILABLE_MB, 0)).toBe(0)
	})

	it('answers undefined when either reading is unread', () => {
		expect(machine_capacity.swapped_between(undefined, 1)).toBeUndefined()
		expect(machine_capacity.swapped_between(1, undefined)).toBeUndefined()
	})
})

// joshuafolkken/kit#3943: the level counted compressible pages as free, so 5.2 GB of reservations
// were admitted while the compressor held 5.9 GB and churned 3.3 GB every three seconds.
const NORMAL = 1
const WARNING = 2
const SWAPPED_MB = 100
const COMPRESSED_MB = 300
const CALM: MemoryReading = {
	available_mb: AVAILABLE_MB,
	swapped_mb: SWAPPED_MB,
	pressure_level: NORMAL,
	compressed_mb: COMPRESSED_MB,
}
const HEAVY_MB = 2000

function claim(key: string, claimed_at: number, admitted_at?: number): LedgerEntry {
	return { key, reservation: { weight: 1, memory_mb: HEAVY_MB, claimed_at, admitted_at } }
}

// `first` is running and in the reading, so the budget adds its memory back.
function admits_second_claim(after: MemoryReading): boolean {
	const available_mb = machine_capacity.pressured_available(after)
	const reading = { busy_cores: 0, available_mb }
	const ledger = { cores: 1, memory_mb: HEAVY_MB }
	const budget = machine_capacity.machine_budget(CORES, reading, ledger)

	return core_admission.is_admitted('second', [claim('first', 0, 0), claim('second', 1)], budget)
}

// joshuafolkken/kit#4313: a machine that swaps and compresses all day held a third of every wait with
// memory to spare, so the traffic alone no longer answers no free memory.
describe('machine_capacity.pressured_available — swap and compressor traffic alone set no limit', () => {
	it('answers the available memory when nothing is under pressure', () => {
		expect(machine_capacity.pressured_available(CALM)).toBe(AVAILABLE_MB)
	})

	it('answers the available memory while swap traffic passes the threshold', () => {
		const after = { ...CALM, swapped_mb: SWAPPED_MB + machine_capacity.SWAP_PRESSURE_MB + 1 }

		expect(machine_capacity.pressured_available(after)).toBe(AVAILABLE_MB)
	})

	it('answers the available memory while compressor traffic passes the threshold', () => {
		const compressed_mb = COMPRESSED_MB + machine_capacity.COMPRESSION_PRESSURE_MB + 1

		expect(machine_capacity.pressured_available({ ...CALM, compressed_mb })).toBe(AVAILABLE_MB)
	})

	it('admits a claim under swap traffic when the free memory holds what it declares', () => {
		const swapping = { ...CALM, swapped_mb: SWAPPED_MB + machine_capacity.SWAP_PRESSURE_MB + 1 }

		expect(admits_second_claim(swapping)).toBe(true)
	})

	it('holds a claim back when the free memory falls short of what it declares', () => {
		expect(admits_second_claim({ ...CALM, available_mb: HEAVY_MB - 1 })).toBe(false)
	})

	it('leaves memory that could not be read unread, so it sets no limit', () => {
		const unread = { available_mb: undefined, swapped_mb: undefined, pressure_level: undefined }

		expect(machine_capacity.pressured_available(unread)).toBeUndefined()
	})
})

describe('machine_capacity.pressured_available — the kernel verdict', () => {
	const CRITICAL = { ...CALM, pressure_level: machine_capacity.PRESSURE_HOLD }

	it('answers no free memory while the kernel reports critical pressure', () => {
		expect(machine_capacity.pressured_available(CRITICAL)).toBe(0)
	})

	// joshuafolkken/kit#4199: macOS keeps the warning long after the pressure passed.
	it('answers the available memory under the kernel warning alone', () => {
		const after = { ...CALM, pressure_level: WARNING }

		expect(machine_capacity.pressured_available(after)).toBe(AVAILABLE_MB)
	})

	it('holds a heavy claim back under pressure and admits it when there is none', () => {
		expect(admits_second_claim(CRITICAL)).toBe(false)
		expect(admits_second_claim(CALM)).toBe(true)
	})
})

const SWAPOUTS_TOTAL = 512
const BYTES_PER_MB = 1_048_576
// One megabyte past the threshold, in pages, swapped out during the window.
const SWAPPED_PAGES = ((machine_capacity.SWAP_PRESSURE_MB + 1) * BYTES_PER_MB) / PAGE_BYTES
const SWAPPING_SYSCTL = DARWIN_SYSCTL.replace(
	`swapouts_total: ${String(SWAPOUTS_TOTAL)}`,
	() => `swapouts_total: ${String(SWAPOUTS_TOTAL + SWAPPED_PAGES)}`,
)

// The real `read_machine` — the machine guard replaces it in every worker — with a sysctl whose swap
// counter advances while the window is waited out.
async function read_swapping_machine(): Promise<MachineReading> {
	const actual = await vi.importActual<{ machine_capacity: typeof machine_capacity }>(
		'./machine-capacity',
	)

	vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
	hanging_execa.answer_with('sysctl', DARWIN_SYSCTL)

	return await actual.machine_capacity.read_machine(async () => {
		hanging_execa.answer_with('sysctl', SWAPPING_SYSCTL)
		await Promise.resolve()
	})
}

describe('machine_capacity.read_machine — memory read at both ends of the window', () => {
	it('names the pressure but keeps the free memory when the swap counter advanced during the window', async () => {
		const reading = await read_swapping_machine()

		expect(reading.memory_pressured).toBe(true)
		expect(reading.available_mb).toBeGreaterThan(0)
	})
})
