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

describe('machine_capacity memory readers', () => {
	it('reads the macOS pressure level as a share of physical memory', () => {
		const level = 58
		const total_mb = EIGHTEEN_GB / (1024 * 1024)

		expect(machine_capacity.parse_darwin_pressure(`${String(level)}\n`, EIGHTEEN_GB)).toBeCloseTo(
			(total_mb * level) / 100,
		)
	})

	it('answers undefined for an unreadable pressure level', () => {
		expect(machine_capacity.parse_darwin_pressure('', EIGHTEEN_GB)).toBeUndefined()
	})

	it('reads MemAvailable from /proc/meminfo in MB', () => {
		const meminfo = 'MemTotal:       16384000 kB\nMemAvailable:    4096000 kB\n'

		expect(machine_capacity.parse_linux_available(meminfo)).toBe(4000)
	})

	it('answers undefined when MemAvailable is absent', () => {
		expect(machine_capacity.parse_linux_available('MemTotal: 1 kB\n')).toBeUndefined()
	})
})
