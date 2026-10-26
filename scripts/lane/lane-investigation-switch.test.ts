import { afterEach, describe, expect, it, vi } from 'vitest'
import { lane_investigation_switch } from './lane-investigation-switch'

const KEY = 'JOSH_LANE_INVESTIGATION'

describe('lane_investigation_switch.is_on', () => {
	afterEach(() => vi.unstubAllEnvs())

	it('is off when the variable is unset', () => {
		vi.stubEnv(KEY, undefined)

		expect(lane_investigation_switch.is_on()).toBe(false)
	})

	it.each(['', 'off', 'maybe'])('is off for %j', (value) => {
		vi.stubEnv(KEY, value)

		expect(lane_investigation_switch.is_on()).toBe(false)
	})

	it.each(['on', ' ON '])('is on for %j', (value) => {
		vi.stubEnv(KEY, value)

		expect(lane_investigation_switch.is_on()).toBe(true)
	})
})
