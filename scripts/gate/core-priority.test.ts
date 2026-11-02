import { afterEach, describe, expect, it, vi } from 'vitest'
import { core_priority } from './core-priority'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('core_priority.marker_field', () => {
	it('answers true under the mark the environment carries', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '1')

		expect(core_priority.marker_field({})).toBe(true)
	})

	it('answers nothing without the mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '')

		expect(core_priority.marker_field({})).toBeUndefined()
	})

	it('answers nothing for the unit suite under the mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '1')

		expect(core_priority.marker_field({ is_unit: true })).toBeUndefined()
	})

	it('answers nothing for another whole suite under the mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '1')

		expect(core_priority.marker_field({ is_suite: true })).toBeUndefined()
	})
})
