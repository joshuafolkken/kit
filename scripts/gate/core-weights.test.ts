import { ESLINT_HEAP_MIB } from '#scripts/lint/eslint-heap'
import { describe, expect, it } from 'vitest'
import { core_weights } from './core-weights'

// joshuafolkken/kit#4362: eslint ran at 124–147% CPU while the floored weights claimed one core for it.
const ESLINT_PEAK_CORES = 1.5
// joshuafolkken/kit#6684: the eslint RSS peak `josh lane:stats --period 7` recorded across lanes.
const ESLINT_PEAK_MB = 7000
const BYTES_PER_MIB = 1_048_576
const BYTES_PER_MB = 1_000_000
const LEDGER_P90_FLOOR = 1.7
const WHOLE_TWO_CORES = 2

describe('core_weights — the declared cost of each heavy tool', () => {
	it('declares every core weight as a positive number of tenths', () => {
		for (const weight of Object.values(core_weights.CORE_WEIGHTS)) {
			expect(weight).toBeGreaterThan(0)
			expect(core_weights.tenth_rounded_up(weight)).toBe(weight)
		}
	})

	it('declares every memory size as positive', () => {
		for (const memory_mb of Object.values(core_weights.MEMORY_MB)) {
			expect(memory_mb).toBeGreaterThan(0)
		}
	})

	it('rounds every measured tool up to the whole cores it kept busy', () => {
		const weights: Readonly<Record<string, number>> = core_weights.CORE_WEIGHTS

		for (const [tool, measurement] of Object.entries(core_weights.MEASURED)) {
			expect(weights[tool]).toBe(Math.ceil(measurement.cpu_s / measurement.wall_s))
		}
	})

	// joshuafolkken/kit#4595: metrics runs only an untyped `max-lines` eslint pass, so even with its
	// merge-base child it holds less than the typed whole-tree eslint scan.
	it('sizes the metrics memory below the whole-tree eslint scan peak', () => {
		expect(core_weights.MEMORY_MB.metrics).toBeLessThan(core_weights.MEMORY_MB.eslint_scan)
	})

	// joshuafolkken/kit#5140: the gate ledger's cspell runs kept a median of 0.91 cores busy.
	it('weighs the spell check at one core', () => {
		expect(core_weights.CORE_WEIGHTS.spell_check).toBe(1)
	})

	it.each(['lint', 'eslint_scan'] as const)(
		'never weighs the %s eslint run below the cores it was measured at',
		(tool) => {
			expect(core_weights.CORE_WEIGHTS[tool]).toBeGreaterThanOrEqual(ESLINT_PEAK_CORES)
		},
	)
})

// joshuafolkken/kit#7776: lint and metrics kept a p90 of 1.7 cores busy, never the two they claimed.
describe('core_weights — the weights read off the lane ledger', () => {
	it('rounds every ledger p90 up to the tenth of a core at or above it', () => {
		const weights: Readonly<Record<string, number>> = core_weights.CORE_WEIGHTS

		for (const [tool, p90] of Object.entries(core_weights.LEDGER_P90)) {
			expect(weights[tool]).toBe(core_weights.tenth_rounded_up(p90))
			expect(weights[tool]).toBeGreaterThanOrEqual(p90)
		}
	})

	it.each(['lint', 'metrics'] as const)('weighs %s from 1.7 up to below two cores', (tool) => {
		expect(core_weights.CORE_WEIGHTS[tool]).toBeGreaterThanOrEqual(LEDGER_P90_FLOOR)
		expect(core_weights.CORE_WEIGHTS[tool]).toBeLessThan(WHOLE_TWO_CORES)
	})

	// The type check's ledger maximum of 4.6 cores is past even its claim.
	it('keeps the type check at its whole two cores', () => {
		expect(core_weights.CORE_WEIGHTS.type_check).toBe(WHOLE_TWO_CORES)
	})

	it.each([
		[1.675, 1.7],
		[1.706, 1.8],
		[1.7, 1.7],
		[0.1 + 0.2, 0.3],
	])('rounds %d up to the tenth %d', (cores, expected) => {
		expect(core_weights.tenth_rounded_up(cores)).toBe(expected)
	})

	it.each([
		[1.7 + 2 + 1, 5],
		[1.7 + 1.3, 3],
		[2 + 2 + 1, 5],
	])('covers a sum of %d cores with %d whole cores', (cores, expected) => {
		expect(core_weights.whole_cores(cores)).toBe(expected)
	})
})

// joshuafolkken/kit#6684: the ledger reserved less than the heap eslint was launched under, so
// several lanes' lints were admitted together and swapped.
describe('core_weights — the eslint reservation and its heap cap', () => {
	it.each(['lint', 'eslint_scan'] as const)(
		'reserves the %s eslint run its heap cap, in megabytes rounded up',
		(tool) => {
			const heap_bytes = core_weights.ESLINT_HEAP_MIB * BYTES_PER_MIB

			expect(core_weights.MEMORY_MB[tool]).toBe(Math.ceil(heap_bytes / BYTES_PER_MB))
		},
	)

	it.each(['lint', 'eslint_scan'] as const)(
		'never reserves the %s eslint run below its measured lane peak',
		(tool) => {
			expect(core_weights.MEMORY_MB[tool]).toBeGreaterThanOrEqual(ESLINT_PEAK_MB)
		},
	)

	it('launches eslint under the heap the budget reserves', () => {
		expect(ESLINT_HEAP_MIB).toBe(core_weights.ESLINT_HEAP_MIB)
	})
})
