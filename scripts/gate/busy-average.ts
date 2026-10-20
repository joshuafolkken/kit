import type { MachineReading } from './machine-capacity'

// **The busy cores a waiting claim admits against are the mean of its last few seconds of readings**
// (joshuafolkken/kit#4238). One reading covers a 250 ms window, and a CPU near saturation swings across
// the threshold from one window to the next, so a claim judged on each reading alone would be admitted
// on a dip into load that is still there. A claim's readings are its own: each poll of one wait adds
// one, and its first poll judges on the one it has.

// Long enough to hold about ten polls of a waiting claim, short enough that a CPU freed a moment ago is
// admitted against within seconds.
const AVERAGE_WINDOW_MS = 3000

interface BusySample {
	at: number
	busy_cores: number
}

// The samples still inside the window once `reading` taken at `now` is added. An unread reading adds
// nothing: where the machine cannot be read, nothing is averaged.
function with_reading(
	samples: ReadonlyArray<BusySample>,
	reading: MachineReading,
	now: number,
): Array<BusySample> {
	const kept = samples.filter((sample) => now - sample.at < AVERAGE_WINDOW_MS)
	const { busy_cores } = reading

	return busy_cores === undefined ? kept : [...kept, { at: now, busy_cores }]
}

// `reading` with its busy cores replaced by the mean of `samples`, or unchanged when none were read.
function averaged(reading: MachineReading, samples: ReadonlyArray<BusySample>): MachineReading {
	if (reading.busy_cores === undefined || samples.length === 0) return reading

	let total = 0

	for (const sample of samples) total += sample.busy_cores

	return { ...reading, busy_cores: total / samples.length }
}

const busy_average = { AVERAGE_WINDOW_MS, averaged, with_reading }

export type { BusySample }
export { busy_average }
