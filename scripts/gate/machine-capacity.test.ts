import { describe, expect, it } from 'vitest'
import { machine_capacity, type MachineReading } from './machine-capacity'

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
// 256 + 512 pages of 4 KB: 3 MB swapped since boot.
const DARWIN_LEVEL = 'kern.memorystatus_level: 58'
const DARWIN_SYSCTL = [
	DARWIN_LEVEL,
	'vm.compressor.swapper.swapins_total: 256',
	'vm.compressor.swapper.swapouts_total: 512',
	`hw.pagesize: ${String(PAGE_BYTES)}`,
].join('\n')

describe('machine_capacity.machine_budget — the budget the ledger admits against', () => {
	it('is the core count when nothing outside the ledger is busy', () => {
		const reading = { busy_cores: LEDGER_CORES, available_mb: AVAILABLE_MB }
		const ledger = { cores: LEDGER_CORES, memory_mb: 0 }

		expect(machine_capacity.machine_budget(CORES, reading, ledger).cores).toBe(CORES)
	})

	it('gives way to busy cores beyond the baseline the weights were measured beside', () => {
		const external = 5
		const reading = { busy_cores: external, available_mb: AVAILABLE_MB }
		const expected = CORES - (external - machine_capacity.BASELINE_CORES)

		expect(machine_capacity.machine_budget(CORES, reading, NO_LEDGER).cores).toBe(expected)
	})

	it('does not count the baseline itself as external load', () => {
		const reading = { busy_cores: machine_capacity.BASELINE_CORES, available_mb: undefined }

		expect(machine_capacity.machine_budget(CORES, reading, NO_LEDGER).cores).toBe(CORES)
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
		})
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
	})

	it('leaves a figure unread when its sysctl name is missing', () => {
		const level_only = machine_capacity.parse_darwin_memory(DARWIN_LEVEL, EIGHTEEN_GB)

		expect(level_only.swapped_mb).toBeUndefined()
		expect(level_only.pressure_level).toBeUndefined()
		expect(machine_capacity.parse_darwin_memory('', EIGHTEEN_GB)).toStrictEqual({
			available_mb: undefined,
			swapped_mb: undefined,
			pressure_level: undefined,
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
