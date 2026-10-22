import { describe, expect, it } from 'vitest'
import { test_module_elapsed, type TimedModule } from './test-module-elapsed'

// joshuafolkken/kit#4465: the one timing both the slowest-files reporter and the duration record read.

const SETUP_MS = 1.2
const DURATION_MS = 10.4
const ROUNDED_TOTAL_MS = 15

function timed(setup: number, duration: number): TimedModule {
	return {
		moduleId: '/repository/one.test.ts',
		diagnostic: () => ({
			environmentSetupDuration: setup,
			prepareDuration: setup,
			collectDuration: setup,
			setupDuration: setup,
			duration,
		}),
	}
}

describe('test_module_elapsed.elapsed_of', () => {
	it('adds every phase from the environment setup to the last test, rounded', () => {
		expect(test_module_elapsed.elapsed_of(timed(SETUP_MS, DURATION_MS))).toBe(ROUNDED_TOTAL_MS)
	})

	it('answers zero for a file that took no time', () => {
		expect(test_module_elapsed.elapsed_of(timed(0, 0))).toBe(0)
	})
})
