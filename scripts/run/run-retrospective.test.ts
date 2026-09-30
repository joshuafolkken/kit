import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_retrospective, type RetrospectiveFacts } from './run-retrospective'

const OWED: RetrospectiveFacts = {
	is_retrospective_enabled: true,
	is_lane_child: false,
	is_retrospective_done: false,
	is_consumer: false,
}

describe('run_retrospective.is_enabled', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('is off when the variable is unset', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', undefined)

		expect(run_retrospective.is_enabled()).toBe(false)
	})

	it('is off for an unrecognized value', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', 'maybe')

		expect(run_retrospective.is_enabled()).toBe(false)
	})

	it('is on for an enabling value', () => {
		vi.stubEnv('JOSH_RETROSPECTIVE', 'on')

		expect(run_retrospective.is_enabled()).toBe(true)
	})
})

describe('run_retrospective.is_owed', () => {
	it('is owed only with the switch on and no exclusion', () => {
		expect(run_retrospective.is_owed(OWED)).toBe(true)
	})

	it.each([
		['the switch is off', { is_retrospective_enabled: false }],
		['a lane child', { is_lane_child: true }],
		['already done', { is_retrospective_done: true }],
		['a consumer checkout', { is_consumer: true }],
	])('is not owed when %s', (_label, override) => {
		expect(run_retrospective.is_owed({ ...OWED, ...override })).toBe(false)
	})
})
