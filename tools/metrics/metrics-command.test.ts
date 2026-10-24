import { describe, expect, it } from 'vitest'
import { metrics_command } from './metrics-command'

const ACCEPT = '--accept'
const REASON = '--reason'
const NO_STARTUP = '--no-startup'
const TOTALS_ONLY = '--totals-only'
const RERECORD = '--rerecord'
const JSON_FORM = '--json'

describe('metrics_command.parse_arguments', () => {
	it('checks against the merge-base, timing the startups, when no argument is given', () => {
		expect(metrics_command.parse_arguments([])).toStrictEqual({
			reason: undefined,
			is_startup_timed: true,
			form: 'full',
		})
	})

	// joshuafolkken/kit#3409: the gate's form, run beside the unit suite.
	it('checks without timing the startups in the gate form', () => {
		expect(metrics_command.parse_arguments([NO_STARTUP])).toStrictEqual({
			reason: undefined,
			is_startup_timed: false,
			form: 'full',
		})
		expect(metrics_command.parse_arguments([NO_STARTUP, ACCEPT])).toBeUndefined()
	})

	// joshuafolkken/kit#3568: the totals without the durations; ship's pre-detach adds `--rerecord`.
	it('checks the totals alone in the pre-detach form', () => {
		expect(metrics_command.parse_arguments([TOTALS_ONLY])).toStrictEqual({
			reason: undefined,
			is_startup_timed: false,
			form: 'totals',
		})
		expect(metrics_command.parse_arguments([TOTALS_ONLY, NO_STARTUP])).toBeUndefined()
	})

	// joshuafolkken/kit#3644: the form the command runs on the merge-base's tree.
	it('prints the totals as JSON, held to nothing, in the merge-base form', () => {
		expect(metrics_command.parse_arguments([JSON_FORM])).toStrictEqual({
			reason: undefined,
			is_startup_timed: false,
			form: 'json',
		})
		expect(metrics_command.parse_arguments([JSON_FORM, ACCEPT])).toBeUndefined()
	})
})

describe('metrics_command.parse_arguments — the accept form', () => {
	it('records the growth with the trimmed reason in the full accept form', () => {
		const reason = 'New guard for #1'

		expect(metrics_command.parse_arguments([ACCEPT, REASON, `  ${reason} `])).toStrictEqual({
			reason,
			is_startup_timed: true,
			form: 'full',
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

// joshuafolkken/kit#4716: only ship's pre-detach form re-records the approval file.
describe('metrics_command.parse_arguments — the rerecord form', () => {
	it('re-records the approved growth only after --totals-only', () => {
		expect(metrics_command.parse_arguments([TOTALS_ONLY, RERECORD])).toStrictEqual({
			reason: undefined,
			is_startup_timed: false,
			form: 'rerecord',
		})
		expect(metrics_command.parse_arguments([RERECORD])).toBeUndefined()
		expect(metrics_command.parse_arguments([RERECORD, TOTALS_ONLY])).toBeUndefined()
	})
})
