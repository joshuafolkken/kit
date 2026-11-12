import { describe, expect, it } from 'vitest'
import { busy_average, type BusySample } from './busy-average'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#4238: one reading of a CPU near saturation swings across the admission
// threshold, so a claim judged on each reading alone is admitted on a momentary dip. A waiting claim
// judges on the mean of its last few seconds instead.

const SATURATED = 11
const DIPPED = 3
const RESERVED = 10
const STEP_MS = 300

function reading(busy_cores: number | undefined): MachineReading {
	return { busy_cores, available_mb: undefined }
}

// Readings taken `STEP_MS` apart, starting at 0, against an empty ledger.
function sampled(busy: ReadonlyArray<number>): Array<BusySample> {
	let samples: Array<BusySample> = []

	for (const [index, busy_cores] of busy.entries()) {
		samples = busy_average.with_reading(samples, reading(busy_cores), 0, index * STEP_MS)
	}

	return samples
}

describe('busy_average — the busy cores a waiting claim admits against', () => {
	it('holds a momentary dip near the saturated level', () => {
		const samples = sampled([SATURATED, SATURATED, SATURATED, DIPPED])
		const mean = busy_average.averaged(reading(DIPPED), samples, 0).busy_cores

		expect(mean).toBe((SATURATED * 3 + DIPPED) / samples.length)
	})

	it('drops the readings older than the window', () => {
		const samples = busy_average.with_reading(
			sampled([SATURATED]),
			reading(DIPPED),
			0,
			busy_average.AVERAGE_WINDOW_MS,
		)

		expect(busy_average.averaged(reading(DIPPED), samples, 0).busy_cores).toBe(DIPPED)
	})

	it('adds nothing for an unread reading, and leaves it unread', () => {
		const unread = reading(undefined)
		const samples = busy_average.with_reading(sampled([SATURATED]), unread, 0, STEP_MS)

		expect(samples).toHaveLength(1)
		expect(busy_average.averaged(unread, samples, 0)).toBe(unread)
	})

	// A claim released inside the window took its busy cores with it: they were the ledger's while it
	// held them, so they do not linger in the mean as load outside it.
	it('does not count a claim released inside the window as outside load', () => {
		const held = busy_average.with_reading([], reading(SATURATED), RESERVED, 0)
		const released = busy_average.with_reading(held, reading(1), 0, STEP_MS)

		expect(busy_average.averaged(reading(1), released, 0).busy_cores).toBe(1)
	})
})

// joshuafolkken/kit#4982: on a saturated machine a claim waited out the two-minute cap though the load
// never fell. A wait now tracks when the load last eased, a whole core at a time.
// joshuafolkken/kit#5391: the raw mean is not floored at the ledger's declared cores, so a ledger that
// reserves more than it runs leaves the machine room to show.
describe('busy_average.mean_busy — the raw busy cores a wait has read', () => {
	it('averages the raw readings below the ledger the samples were taken against', () => {
		const samples = busy_average.with_reading(
			busy_average.with_reading([], reading(DIPPED), RESERVED, 0),
			reading(DIPPED + 2),
			RESERVED,
			STEP_MS,
		)

		expect(busy_average.mean_busy(samples)).toBe(DIPPED + 1)
	})

	it('answers undefined before any reading', () => {
		expect(busy_average.mean_busy([])).toBeUndefined()
	})
})

const WINDOW_MS = 1000

describe('busy_average.with_ease — when the load a wait reads last eased', () => {
	it('starts at the first reading, unrelieved once a window passes with no fall', () => {
		const first = busy_average.with_ease(undefined, SATURATED, 0)
		const ease = busy_average.with_ease(first, SATURATED, WINDOW_MS)

		expect(ease).toStrictEqual({ level: SATURATED, eased_at: 0 })
		expect(busy_average.is_unrelieved(ease, WINDOW_MS, WINDOW_MS)).toBe(true)
	})

	it('restarts the window on a fall of a whole core', () => {
		const ease = busy_average.with_ease({ level: SATURATED, eased_at: 0 }, SATURATED - 1, STEP_MS)

		expect(ease).toStrictEqual({ level: SATURATED - 1, eased_at: STEP_MS })
		expect(busy_average.is_unrelieved(ease, WINDOW_MS, WINDOW_MS)).toBe(false)
	})

	it('counts neither a fall under a core nor a rise as easing', () => {
		const start = { level: SATURATED, eased_at: 0 }

		expect(busy_average.with_ease(start, SATURATED - 0.5, STEP_MS)).toBe(start)
		expect(busy_average.with_ease(start, SATURATED + 1, STEP_MS)).toBe(start)
	})

	it('never judges a wait unrelieved where the machine is unread', () => {
		const ease = busy_average.with_ease(undefined, undefined, 0)

		expect(ease).toBeUndefined()
		expect(busy_average.is_unrelieved(ease, WINDOW_MS, WINDOW_MS)).toBe(false)
	})
})
