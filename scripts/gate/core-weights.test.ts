import { describe, expect, it } from 'vitest'
import { core_weights } from './core-weights'

// joshuafolkken/kit#4362: eslint ran at 124–147% CPU while the floored weights claimed one core for it.
const ESLINT_PEAK_CORES = 1.5

describe('core_weights — the declared cost of each heavy tool', () => {
	it('declares every core weight as a positive whole number', () => {
		for (const weight of Object.values(core_weights.CORE_WEIGHTS)) {
			expect(Number.isSafeInteger(weight) && weight > 0).toBe(true)
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

	it.each(['lint', 'eslint_scan'] as const)(
		'never weighs the %s eslint run below the cores it was measured at',
		(tool) => {
			expect(core_weights.CORE_WEIGHTS[tool]).toBeGreaterThanOrEqual(ESLINT_PEAK_CORES)
		},
	)
})
