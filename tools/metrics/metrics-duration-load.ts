import type { LedgerEntry, LoadEntry } from '#scripts/lane/lane-ledger'
import { lane_sampler } from '#scripts/lane/lane-sampler'
import { metrics_durations, type DurationChange, type MeasuredWindow } from './metrics-durations'

// Whether the machine was busy while the gate and unit durations were measured: inside the span of a
// gate the median takes. A solo gate is read quiet at its two ends alone, so another lane's work
// between them still slows it; the lane driver's minute-by-minute load samples
// (`scripts/lane/lane-load.ts`) see that work, and a slowdown measured under it warns rather than fails
// (joshuafolkken/kit#4709). Each span is widened by one sample period, since a gate shorter than it
// may fall between two samples. A median moves past the tolerance through busy gates only when they
// are the majority, so only a majority of busy spans excuses it; a span with no sample of a busy
// machine, or no sample at all, is quiet, and a slowdown the quiet majority measured still fails. A
// sample in the idle gap between two gates timed nothing the verdict reads, nor does a startup, timed
// at the check, so neither is excused.

// The lane the gate itself may run in — a lane beyond it is another lane's work.
const OWN_LANES = 1
const HALF = 2
const NEWLINE = '\n'

interface RegressionSplit {
	warned: ReadonlyArray<DurationChange>
	failed: ReadonlyArray<DurationChange>
}

function is_loaded(entry: LoadEntry, cores: number): boolean {
	return (entry.lanes ?? 0) > OWN_LANES || entry.load > cores
}

function is_inside(entry: LoadEntry, window: MeasuredWindow): boolean {
	const at_ms = Date.parse(entry.at)
	const reach_ms = lane_sampler.SAMPLE_INTERVAL_MS

	return at_ms >= window.start_ms - reach_ms && at_ms <= window.end_ms + reach_ms
}

function is_busy_window(
	entries: ReadonlyArray<LedgerEntry>,
	window: MeasuredWindow,
	cores: number,
): boolean {
	return entries.some(
		(entry) => entry.kind === 'load' && is_loaded(entry, cores) && is_inside(entry, window),
	)
}

function is_busy(entries: ReadonlyArray<LedgerEntry>, cores: number): boolean {
	const windows = metrics_durations.windows(entries)
	const busy = windows.filter((window) => is_busy_window(entries, window, cores))

	return busy.length > windows.length / HALF
}

// On a busy interval the gate and unit regressions warn; a startup's still fails.
function split(regressions: ReadonlyArray<DurationChange>, is_excused: boolean): RegressionSplit {
	const warned = is_excused
		? regressions.filter((change) => metrics_durations.is_recorded(change))
		: []

	return { warned, failed: regressions.filter((change) => !warned.includes(change)) }
}

function render_warning(regressions: ReadonlyArray<DurationChange>, baseline_path: string): string {
	return [
		'josh metrics: warning — another lane worked, or the load average passed the cores, while these were measured, so they do not fail the gate:',
		metrics_durations.render_regressions(regressions, baseline_path),
	].join(NEWLINE)
}

const metrics_duration_load = {
	is_busy,
	render_warning,
	split,
}

export { metrics_duration_load }
