import type { LedgerEntry } from './lane-ledger'
import type { SizeEntry } from './lane-ledger-schema'

// A lane judged slow by its pace, not a fixed number of minutes (joshuafolkken/kit#9164): its net minutes
// past the fixed cost every lane pays (start to plan, ship, followup), per 100 actually changed lines,
// against a provisional rate. A fixed target judged the efficient large lanes slow and missed the small
// slow ones; larger lanes measured fewer minutes per 100 lines. `lane:breakdown`, `lane:stats --over`
// and the overrun note `run:board` draws all judge through here, on one value.
// A lane with no recorded size is not judged, and neither is an adopted theme lane — one that takes in
// a consultation session's finished branch (the body's adopt-branch row), whose size says nothing of
// its time.

// Provisional until `lane:stats`'s implement minutes per 100 actual lines calibrate it (decision (c),
// epic joshuafolkken/kit#9127, 2026-11-28).
const RATE_MINUTES = 13.7
// The fixed cost of the smallest lanes measured (joshuafolkken/kit#9164).
const FIXED_MINUTES = 12
const PER_LINES = 100

type Pace =
	| { kind: 'judged'; rate: number; is_slow: boolean }
	| { kind: 'unjudged'; reason: 'unsized' | 'adopted' }

// Minutes past the fixed cost per 100 changed lines; never below zero.
function rate_of(minutes: number, lines: number): number {
	return (Math.max(0, minutes - FIXED_MINUTES) * PER_LINES) / lines
}

function of_size(size: SizeEntry | undefined, minutes: number): Pace {
	if (size?.adopted === true) return { kind: 'unjudged', reason: 'adopted' }
	if (size === undefined || size.actual.lines <= 0) return { kind: 'unjudged', reason: 'unsized' }
	const rate = rate_of(minutes, size.actual.lines)

	return { kind: 'judged', rate, is_slow: rate > RATE_MINUTES }
}

function size_of(entries: ReadonlyArray<LedgerEntry>, issue: number): SizeEntry | undefined {
	return entries.findLast(
		(entry): entry is SizeEntry => entry.kind === 'size' && entry.issue === issue,
	)
}

// The pace of `issue`'s `minutes`, read against its latest recorded size.
function of(entries: ReadonlyArray<LedgerEntry>, issue: number, minutes: number): Pace {
	return of_size(size_of(entries, issue), minutes)
}

// The minutes `issue`'s `minutes` run past what `rate` allows its size — the fixed cost plus `rate`
// per 100 lines — negative within it; `undefined` for a lane the pace leaves unjudged. Past zero is
// exactly a rate over `rate`, so `lane:stats --over <rate>` selects and sums on this one value.
function excess_minutes(
	entries: ReadonlyArray<LedgerEntry>,
	issue: number,
	minutes: number,
	rate: number,
): number | undefined {
	const size = size_of(entries, issue)

	if (size === undefined || of_size(size, minutes).kind === 'unjudged') return undefined

	return minutes - FIXED_MINUTES - (rate * size.actual.lines) / PER_LINES
}

function is_slow(pace: Pace): boolean {
	return pace.kind === 'judged' && pace.is_slow
}

function text(pace: Pace): string {
	if (pace.kind === 'unjudged') {
		return pace.reason === 'adopted'
			? 'pace not judged: an adopted theme lane'
			: 'pace not judged: no recorded size'
	}

	const side = pace.is_slow ? 'over' : 'within'

	return `${pace.rate.toFixed(1)} min / ${String(PER_LINES)} lines past the ${String(FIXED_MINUTES)}-min fixed cost, ${side} the ${String(RATE_MINUTES)}-min pace`
}

const lane_pace = { FIXED_MINUTES, excess_minutes, is_slow, of, rate_of, text }

export { lane_pace }
export type { Pace }
