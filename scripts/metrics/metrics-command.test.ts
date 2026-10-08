import { describe, expect, it } from 'vitest'
import { metrics_command } from './metrics-command'

const ACCEPT = '--accept'
const REASON = '--reason'
const NO_STARTUP = '--no-startup'

describe('metrics_command.parse_arguments', () => {
	it('checks against the baseline, timing the startups, when no argument is given', () => {
		expect(metrics_command.parse_arguments([])).toStrictEqual({
			reason: undefined,
			is_startup_timed: true,
		})
	})

	// joshuafolkken/kit#3409: the gate's form, run beside the unit suite.
	it('checks without timing the startups in the gate form', () => {
		expect(metrics_command.parse_arguments([NO_STARTUP])).toStrictEqual({
			reason: undefined,
			is_startup_timed: false,
		})
		expect(metrics_command.parse_arguments([NO_STARTUP, ACCEPT])).toBeUndefined()
	})

	it('raises the baseline with the trimmed reason in the full accept form', () => {
		const reason = 'New guard for #1'

		expect(metrics_command.parse_arguments([ACCEPT, REASON, `  ${reason} `])).toStrictEqual({
			reason,
			is_startup_timed: true,
		})
	})

	it('refuses an accept without a reason', () => {
		expect(metrics_command.parse_arguments([ACCEPT])).toBeUndefined()
		expect(metrics_command.parse_arguments([ACCEPT, REASON])).toBeUndefined()
		expect(metrics_command.parse_arguments([ACCEPT, REASON, ' '.repeat(3)])).toBeUndefined()
	})

	it('refuses a misspelled flag and the removed --write-baseline', () => {
		expect(metrics_command.parse_arguments([ACCEPT, '--why', 'x'])).toBeUndefined()
		expect(metrics_command.parse_arguments(['--write-baseline'])).toBeUndefined()
	})
})
