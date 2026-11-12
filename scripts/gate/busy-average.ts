import type { MachineReading } from './machine-capacity'

// **The busy cores a waiting claim admits against are the mean of its last few seconds of readings**
// (joshuafolkken/kit#4238). A CPU near saturation swings across
// the threshold from one window to the next, so a claim judged on each reading alone would be admitted
// on a dip into load that is still there. A claim's readings are its own: each poll of one wait adds
// one, and its first poll judges on the one it has.
//
// **What is averaged is the load outside the ledger, each sample against the ledger of its own
// moment.** Averaging the raw busy cores and subtracting the ledger of now would count a claim released
// inside the window as external load: its cores would linger in the mean after leaving the ledger.

// Long enough to hold about ten polls of a waiting claim, short enough that a CPU freed a moment ago is
// admitted against within seconds.
const AVERAGE_WINDOW_MS = 3000

// `busy_cores` is the raw reading, kept beside the load outside the ledger so `mean_busy` can tell
// cores the ledger reserves from cores the machine actually runs.
interface BusySample {
	at: number
	external_cores: number
	busy_cores: number
}

// The samples still inside the window once `reading` taken at `now`, against a ledger holding
// `ledger_cores`, is added. An unread reading adds nothing: where the machine cannot be read, nothing
// is averaged.
function with_reading(
	samples: ReadonlyArray<BusySample>,
	reading: MachineReading,
	ledger_cores: number,
	now: number,
): Array<BusySample> {
	const kept = samples.filter((sample) => now - sample.at < AVERAGE_WINDOW_MS)
	const { busy_cores } = reading

	if (busy_cores === undefined) return kept

	return [...kept, { at: now, external_cores: Math.max(0, busy_cores - ledger_cores), busy_cores }]
}

// The mean of the raw busy cores in `samples`, or `undefined` where none were read. Unlike `averaged`,
// it does not floor the load at the ledger's declared cores: claims that reserve more than they run
// leave this lower (joshuafolkken/kit#5391).
function mean_busy(samples: ReadonlyArray<BusySample>): number | undefined {
	if (samples.length === 0) return undefined

	let total = 0

	for (const sample of samples) total += sample.busy_cores

	return total / samples.length
}

// `reading` with its busy cores replaced by the mean load outside the ledger on top of the ledger's
// `ledger_cores` now, or unchanged when none were read.
function averaged(
	reading: MachineReading,
	samples: ReadonlyArray<BusySample>,
	ledger_cores: number,
): MachineReading {
	if (reading.busy_cores === undefined || samples.length === 0) return reading

	let total = 0

	for (const sample of samples) total += sample.external_cores

	return { ...reading, busy_cores: ledger_cores + total / samples.length }
}

// **A wait that does not ease the load gains nothing by going on** (joshuafolkken/kit#4982). On a
// saturated machine the load never falls, and a claim that waits out the cap only starts at minimum
// width two minutes late. A wait keeps the lowest mean busy count it has read and when it last fell; a
// fall under a whole core is noise, not easing.
const EASE_CORES = 1

interface LoadEase {
	level: number
	eased_at: number
}

// `ease` once the mean `busy_cores` read at `now` is added. An unread machine changes nothing, so a wait
// that cannot read the load is never judged unrelieved.
function with_ease(
	ease: LoadEase | undefined,
	busy_cores: number | undefined,
	now: number,
): LoadEase | undefined {
	if (busy_cores === undefined) return ease

	if (ease === undefined || busy_cores <= ease.level - EASE_CORES) {
		return { level: busy_cores, eased_at: now }
	}

	return ease
}

// Whether the load has not eased for `window_ms` of the wait.
function is_unrelieved(ease: LoadEase | undefined, now: number, window_ms: number): boolean {
	return ease !== undefined && now - ease.eased_at >= window_ms
}

const busy_average = {
	AVERAGE_WINDOW_MS,
	averaged,
	is_unrelieved,
	mean_busy,
	with_ease,
	with_reading,
}

export type { BusySample, LoadEase }
export { busy_average }
