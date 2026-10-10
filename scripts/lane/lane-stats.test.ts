import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_stats } from './lane-stats'

// joshuafolkken/kit#3355: one ledger period reduces to the #3347 table row — throughput per active
// hour, gate duration and machine load, with `—` wherever nothing was sampled.

const NOW = Date.parse('2026-10-06T12:00:00.000Z')
const WINDOW = lane_stats.window_of(1, NOW)
const LABEL = { limit: '4', period_days: 1 }
const GATE_MINUTES = [2, 4, 9]
const MS_PER_MINUTE = 60_000
const MERGE_ISSUE = 7
const PER_HOUR = 'merges / hour'
const GATE_MEDIAN = 'gate median (min)'
const LOAD_PEAK = 'load peak'
const LOAD_SAMPLES = 'load samples'
const LOAD_MEAN = 'load mean'
const EFFECTIVE_LANES = 'effective lanes'
const FREE_MIN = 'free memory min (GB)'
const FREE_MEAN = 'free memory mean (GB)'
const SWAPPED_PEAK = 'swapped peak (GB/h)'
const SWAPPED_MEAN = 'swapped mean (GB/h)'

function hours_before_now(hours: number): string {
	return new Date(NOW - hours * MS_PER_MINUTE * 60).toISOString()
}

function cells(entries: ReadonlyArray<LedgerEntry>): Array<string> {
	return lane_stats.row(entries, WINDOW, LABEL).slice(2, -2).split(' | ')
}

function cell_of(
	entries: ReadonlyArray<LedgerEntry>,
	column: (typeof lane_stats.COLUMNS)[number],
): string | undefined {
	const index = lane_stats.COLUMNS.indexOf(column)

	return cells(entries)[index]
}

const MERGES: ReadonlyArray<LedgerEntry> = [
	{ kind: 'merge', at: hours_before_now(2), issue: MERGE_ISSUE },
	{ kind: 'merge', at: hours_before_now(1), issue: MERGE_ISSUE },
	{ kind: 'merge', at: hours_before_now(0), issue: MERGE_ISSUE },
]

const GATES: ReadonlyArray<LedgerEntry> = GATE_MINUTES.map((minutes) => ({
	kind: 'gate',
	at: hours_before_now(1),
	elapsed_ms: minutes * MS_PER_MINUTE,
	is_passed: true,
}))

const LOADS: ReadonlyArray<LedgerEntry> = [
	{ kind: 'load', at: hours_before_now(1), load: 4, available_mb: 2048, lanes: 2 },
	{ kind: 'load', at: hours_before_now(1), load: 8, available_mb: 1024, lanes: 4 },
]

const HALF_HOUR = 0.5

// Load samples every half hour from `from` hours before now down to `to`, all with `lanes` working.
function samples_between(from: number, to: number, lanes: number): Array<LedgerEntry> {
	const count = Math.round((from - to) / HALF_HOUR) + 1

	return Array.from({ length: count }, (_, index) => ({
		kind: 'load',
		at: hours_before_now(from - index * HALF_HOUR),
		load: 1,
		available_mb: 1024,
		lanes,
	}))
}

describe('lane_stats.row active hours', () => {
	it('leaves a long silence between runs out of the active hours, even with idle samples bridging it', () => {
		const morning: ReadonlyArray<LedgerEntry> = [
			{ kind: 'merge', at: hours_before_now(23), issue: MERGE_ISSUE },
			{ kind: 'merge', at: hours_before_now(22), issue: MERGE_ISSUE },
		]
		const night = samples_between(21.5, 1.5, 0)

		expect(cell_of([...morning, ...night, ...MERGES.slice(1)], PER_HOUR)).toBe('2.0')
	})

	it('counts the time samples saw a lane working, however long the gap between merges', () => {
		const merges: ReadonlyArray<LedgerEntry> = [
			{ kind: 'merge', at: hours_before_now(2.5), issue: MERGE_ISSUE },
			{ kind: 'merge', at: hours_before_now(0), issue: MERGE_ISSUE },
		]
		const idle = samples_between(6, 3.5, 0)
		const working = samples_between(3, 0, 1)

		expect(cell_of([...merges, ...idle, ...working], PER_HOUR)).toBe('0.7')
	})
})

describe('lane_stats.row', () => {
	it('labels the row with the limit and the period', () => {
		expect(cells([]).slice(0, 2)).toStrictEqual(['4', '1'])
	})

	it('counts merges per active hour rather than per calendar hour', () => {
		expect(cell_of(MERGES, 'merges')).toBe('3')
		expect(cell_of(MERGES, PER_HOUR)).toBe('1.5')
	})

	it('leaves the rate empty when a single entry spans no time', () => {
		expect(cell_of(MERGES.slice(0, 1), PER_HOUR)).toBe(lane_stats.MISSING)
	})

	it('ignores entries outside the window', () => {
		const old: LedgerEntry = { kind: 'merge', at: hours_before_now(48), issue: MERGE_ISSUE }

		expect(cell_of([old, ...MERGES], 'merges')).toBe('3')
	})

	it('reduces gates to their median and maximum in minutes', () => {
		expect(cell_of(GATES, GATE_MEDIAN)).toBe('4.0')
		expect(cell_of(GATES, 'gate max (min)')).toBe('9.0')
	})

	it('reduces load samples to load, free memory and lane figures', () => {
		expect(cell_of(LOADS, EFFECTIVE_LANES)).toBe('3.0')
		expect(cell_of(LOADS, LOAD_PEAK)).toBe('8.0')
		expect(cell_of(LOADS, LOAD_MEAN)).toBe('6.0')
		expect(cell_of(LOADS, FREE_MIN)).toBe('1.0')
		expect(cell_of(LOADS, FREE_MEAN)).toBe('1.5')
		expect(cell_of(LOADS, LOAD_SAMPLES)).toBe('2')
	})

	it('prints the missing mark, never zero, for a period with no samples', () => {
		expect(cell_of(MERGES, LOAD_PEAK)).toBe(lane_stats.MISSING)
		expect(cell_of(MERGES, GATE_MEDIAN)).toBe(lane_stats.MISSING)
		expect(cell_of(MERGES, LOAD_SAMPLES)).toBe('0')
	})
})

describe('lane_stats.row working samples', () => {
	it('averages only the samples that saw a lane working, while peaks and minima take every sample', () => {
		const idle: LedgerEntry = {
			kind: 'load',
			at: hours_before_now(1),
			load: 9,
			available_mb: 512,
			lanes: 0,
		}
		const entries = [...LOADS, idle]

		expect(cell_of(entries, EFFECTIVE_LANES)).toBe('3.0')
		expect(cell_of(entries, LOAD_MEAN)).toBe('6.0')
		expect(cell_of(entries, FREE_MEAN)).toBe('1.5')
		expect(cell_of(entries, LOAD_PEAK)).toBe('9.0')
		expect(cell_of(entries, FREE_MIN)).toBe('0.5')
		expect(cell_of(entries, LOAD_SAMPLES)).toBe('3')
	})
})

// A load sample `hours` before now that had swapped `swapped_mb` since boot.
function swapped(hours: number, swapped_mb: number | undefined, lanes: number): LedgerEntry {
	return { kind: 'load', at: hours_before_now(hours), load: 1, swapped_mb, lanes }
}

// joshuafolkken/kit#3593: a sample carries the swap counter, so the columns are its rate between samples.
describe('lane_stats.row swap rate', () => {
	it('reads the swap columns from the counter gained between consecutive samples', () => {
		const entries = [swapped(2, 1024, 1), swapped(1.5, 2048, 0), swapped(1, 6144, 1)]

		expect(cell_of(entries, SWAPPED_PEAK)).toBe('8.0')
		expect(cell_of(entries, SWAPPED_MEAN)).toBe('2.0')
	})

	it('reads a counter that went back as nothing swapped', () => {
		expect(cell_of([swapped(2, 2048, 1), swapped(1.5, 0, 1)], SWAPPED_PEAK)).toBe('0.0')
	})

	it('prints the missing mark where the counter was unread or the sampler was stopped', () => {
		const unread = [swapped(2, undefined, 1), swapped(1.5, 1024, 1)]
		const stopped = [swapped(4, 1024, 1), swapped(1, 2048, 1)]

		expect(cell_of(unread, SWAPPED_PEAK)).toBe(lane_stats.MISSING)
		expect(cell_of(stopped, SWAPPED_PEAK)).toBe(lane_stats.MISSING)
		expect(cell_of(LOADS, SWAPPED_MEAN)).toBe(lane_stats.MISSING)
	})
})

describe('lane_stats.median', () => {
	it('takes the middle of an odd count and the mean of the two middles of an even one', () => {
		expect(lane_stats.median([3, 1, 2])).toBe(2)
		expect(lane_stats.median([4, 1, 3, 2])).toBe(2.5)
		expect(lane_stats.median([])).toBeUndefined()
	})
})

describe('lane_stats.header', () => {
	it('names every column the row fills', () => {
		const [names = ''] = lane_stats.header().split('\n', 1)

		expect(names.split(' | ')).toHaveLength(lane_stats.COLUMNS.length)
		expect(cells(LOADS)).toHaveLength(lane_stats.COLUMNS.length)
	})
})
