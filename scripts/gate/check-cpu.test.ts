import type { RusageReader } from '#scripts/run/board/run-board-usage-rusage'
import { describe, expect, it } from 'vitest'
import { check_cpu } from './check-cpu'

// joshuafolkken/kit#4362: the gate ledger records each check's CPU so a weight can be re-measured.

const PID = 4362
const FIRST_CHECK_MS = 30_000
const SECOND_CHECK_MS = 12_000
const FOOTPRINT_BYTES = 0
const US_PER_MS = 1000

// A reader whose reaped-children time steps through `totals`, on top of the gate's own usage — so the
// subtraction of `process.cpuUsage()` leaves exactly the step.
function stepping_reader(totals: ReadonlyArray<number>): RusageReader {
	const readings = [...totals]

	return function read(): ReturnType<RusageReader> {
		const total = readings.shift()
		if (total === undefined) return undefined
		const own = process.cpuUsage()

		return { cpu_ms: total + (own.user + own.system) / US_PER_MS, footprint_bytes: FOOTPRINT_BYTES }
	}
}

describe('check_cpu.check_cpu_reader', () => {
	it('gives each finished check the growth since the previous one finished', () => {
		const total = FIRST_CHECK_MS + SECOND_CHECK_MS
		const cpu = check_cpu.check_cpu_reader(stepping_reader([0, FIRST_CHECK_MS, total]), PID)

		expect(Math.round(cpu() ?? -1)).toBe(FIRST_CHECK_MS)
		expect(Math.round(cpu() ?? -1)).toBe(SECOND_CHECK_MS)
	})

	it('reads nothing where the gate has no reader', () => {
		expect(check_cpu.check_cpu_reader(undefined, PID)()).toBeUndefined()
	})

	it('reads nothing where the gate could not be read at the baseline', () => {
		const cpu = check_cpu.check_cpu_reader(stepping_reader([]), PID)

		expect(cpu()).toBeUndefined()
	})
})
