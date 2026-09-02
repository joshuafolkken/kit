import { afterEach, describe, expect, it, vi } from 'vitest'
import { eval_switch } from './eval-switch'

// joshuafolkken/kit#1235: the measurement is opt-in, so the case that matters most is the one nobody
// configures — a checkout that has never heard of the variable must answer "off" rather than paying
// five real Claude sessions for a suite that almost never reached `held`.

const KEY = eval_switch.SWITCH_ENV_KEY

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('eval_switch.is_enabled', () => {
	// The default the whole change exists for. An unset variable is the state of every machine that
	// was never told about this switch, including CI.
	it('is off when nothing sets the variable', () => {
		vi.stubEnv(KEY, undefined)

		expect(eval_switch.is_enabled()).toBe(false)
	})

	// Several spellings, because a value meant to turn the suite on that the list does not recognize
	// fails silently: the caller sees no measurement and no complaint, which is exactly what they saw
	// before setting anything.
	it.each([...eval_switch.ENABLED_VALUES, 'ON', ' on ', 'True'])(
		'turns the measurement on for %s',
		(value) => {
			vi.stubEnv(KEY, value)

			expect(eval_switch.is_enabled()).toBe(true)
		},
	)

	// The values a person would write to mean "off" answer off, and so does anything unrecognized —
	// there is no spelling that turns it on by accident.
	it.each(['off', '0', 'false', 'no', '', ' '.repeat(3), 'maybe'])(
		'leaves it off for %s',
		(value) => {
			vi.stubEnv(KEY, value)

			expect(eval_switch.is_enabled()).toBe(false)
		},
	)
})

describe('eval_switch.DISABLED_REASON', () => {
	// The reason line is the only thing standing between an unexpected `skip` and a reader concluding
	// the trigger is broken, so it has to name the variable and the way back.
	it('names the variable and how to measure again', () => {
		expect(eval_switch.DISABLED_REASON).toContain(KEY)
		expect(eval_switch.DISABLED_REASON).toContain(`${KEY}=on`)
	})
})
