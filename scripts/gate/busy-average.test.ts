import { describe, expect, it } from 'vitest'
import { busy_average, type BusySample } from './busy-average'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#4238: one 250 ms reading of a CPU near saturation swings across the admission
// threshold, so a claim judged on each reading alone is admitted on a momentary dip. A waiting claim
// judges on the mean of its last few seconds instead.

const SATURATED = 11
const DIPPED = 3
const STEP_MS = 300

function reading(busy_cores: number | undefined): MachineReading {
	return { busy_cores, available_mb: undefined }
}

// Readings taken `STEP_MS` apart, starting at 0.
function sampled(busy: ReadonlyArray<number>): Array<BusySample> {
	let samples: Array<BusySample> = []

	for (const [index, busy_cores] of busy.entries()) {
		samples = busy_average.with_reading(samples, reading(busy_cores), index * STEP_MS)
	}

	return samples
}

describe('busy_average — the busy cores a waiting claim admits against', () => {
	it('holds a momentary dip near the saturated level', () => {
		const samples = sampled([SATURATED, SATURATED, SATURATED, DIPPED])
		const mean = busy_average.averaged(reading(DIPPED), samples).busy_cores

		expect(mean).toBe((SATURATED * 3 + DIPPED) / samples.length)
	})

	it('drops the readings older than the window', () => {
		const samples = busy_average.with_reading(
			sampled([SATURATED]),
			reading(DIPPED),
			busy_average.AVERAGE_WINDOW_MS,
		)

		expect(busy_average.averaged(reading(DIPPED), samples).busy_cores).toBe(DIPPED)
	})

	it('adds nothing for an unread reading, and leaves it unread', () => {
		const unread = reading(undefined)
		const samples = busy_average.with_reading(sampled([SATURATED]), unread, STEP_MS)

		expect(samples).toHaveLength(1)
		expect(busy_average.averaged(unread, samples)).toBe(unread)
	})
})
