import { describe, expect, it } from 'vitest'
import { core_weights } from './core-weights'

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
})
