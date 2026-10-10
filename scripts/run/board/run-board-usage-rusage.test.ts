import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_usage_rusage } from './run-board-usage-rusage'

// joshuafolkken/kit#3529: a process's CPU time with its reaped children's, read through the
// experimental `node:ffi` where it exists, and no reader where it does not.

const { cpu_ms_of, quiet_ffi, rusage_reader } = run_board_usage_rusage
const RUSAGE_INFO_V2_BYTES = 160
// Apple silicon's mach timebase: 125 / 3 ns a tick.
const TIMEBASE = { numer: 125, denom: 3 }
const LIVE_PID = 42
const FAILED = -1

// 70,000,000 ticks of 125 / 3 ns across the four times.
function write_times(buffer: Buffer): void {
	buffer.writeBigUInt64LE(24_000_000n, 16)
	buffer.writeBigUInt64LE(6_000_000n, 24)
	buffer.writeBigUInt64LE(39_597_667n, 96)
	buffer.writeBigUInt64LE(402_333n, 104)
}

// A stand-in for `node:ffi` whose `proc_pid_rusage` answers `LIVE_PID` alone.
function proc_pid_rusage(pid: number, _flavor: number, buffer: Buffer): number {
	if (pid !== LIVE_PID) return FAILED

	write_times(buffer)

	return 0
}

function mach_timebase_info(buffer: Buffer): number {
	buffer.writeUInt32LE(TIMEBASE.numer, 0)
	buffer.writeUInt32LE(TIMEBASE.denom, 4)

	return 0
}

function fake_ffi(): unknown {
	return { dlopen: () => ({ functions: { proc_pid_rusage, mach_timebase_info } }) }
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_usage_rusage.cpu_ms_of', () => {
	it('sums its own and its reaped children’s user and system time, in milliseconds', () => {
		const buffer = Buffer.alloc(RUSAGE_INFO_V2_BYTES)

		write_times(buffer)

		expect(cpu_ms_of(buffer, TIMEBASE)).toBeCloseTo(2916.667)
	})
})

describe('run_board_usage_rusage.rusage_reader', () => {
	it('has no reader on a Node without node:ffi', () => {
		expect(rusage_reader('darwin', () => undefined)).toBeUndefined()
	})

	it('has no reader off macOS, and never loads node:ffi there', () => {
		const load = vi.fn()

		expect(rusage_reader('linux', load)).toBeUndefined()
		expect(load).not.toHaveBeenCalled()
	})

	it('has no reader when node:ffi cannot open the library', () => {
		const ffi = {
			dlopen: () => {
				throw new Error('no library')
			},
		}

		expect(rusage_reader('darwin', () => ffi)).toBeUndefined()
	})

	it('reads a process through proc_pid_rusage, and nothing where the call fails', () => {
		const read = rusage_reader('darwin', fake_ffi)

		expect(read?.(LIVE_PID)).toBeCloseTo(2916.667)
		expect(read?.(LIVE_PID + 1)).toBeUndefined()
	})
})

describe('run_board_usage_rusage.quiet_ffi', () => {
	it('drops the load’s ExperimentalWarning, passes any other warning on, and restores emitWarning', () => {
		const emit = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined)
		const original = process.emitWarning

		const other = ['something else', 'DeprecationWarning'] as const

		quiet_ffi((id) => {
			process.emitWarning('FFI is an experimental feature', 'ExperimentalWarning')
			process.emitWarning(...other)

			return { id }
		})

		expect(emit).toHaveBeenCalledTimes(1)
		expect(emit).toHaveBeenCalledWith(...other)
		expect(process.emitWarning).toBe(original)
	})
})
