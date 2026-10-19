import { NO_CHECKS_MESSAGE } from '#scripts/gh/git-pr-checks-watch'
import { describe, expect, it } from 'vitest'
import { run_ship_stop_cause } from './run-ship-stop-cause'

// joshuafolkken/kit#3998: a ship stop names why it stopped, and only a stop on the infrastructure is
// worth re-running in place.

const { CAUSE, cause_of } = run_ship_stop_cause
const RATE_LIMITED = 'CodeRabbit: Review rate limit exceeded'

describe('run_ship_stop_cause.cause_of', () => {
	it.each([
		RATE_LIMITED,
		`pr checks --watch failed; falling through to polling: ${NO_CHECKS_MESSAGE}`,
		'fetch failed: read ECONNRESET',
		'error connecting to api.github.com: socket hang up',
		'fatal: unable to access: Could not resolve host: github.com',
		'HTTP 502: Bad Gateway (https://api.github.com/graphql)',
	])('reads a followup that stopped on %s as the infrastructure', (output) => {
		expect(cause_of('followup', output)).toBe(CAUSE.INFRA)
	})

	it.each(['sync', 'commit', 'report'] as const)(
		'reads a %s stop for the infrastructure',
		(stage) => {
			expect(cause_of(stage, RATE_LIMITED)).toBe(CAUSE.INFRA)
		},
	)
})

describe('run_ship_stop_cause.cause_of — every stop that is not the infrastructure', () => {
	it('reads a followup on a red check as a check', () => {
		expect(cause_of('followup', 'CI / test failed')).toBe(CAUSE.CHECK)
	})

	it.each(['gate', 'preflight'] as const)(
		'never reads a %s stop as the infrastructure, whatever its output names',
		(stage) => {
			expect(cause_of(stage, `✗ retries after a ${RATE_LIMITED}`)).toBe(CAUSE.CHECK)
		},
	)

	it.each(['review', 'round-2'] as const)('reads a %s stop as a finding', (stage) => {
		expect(cause_of(stage, RATE_LIMITED)).toBe(CAUSE.FINDING)
	})

	it('reads a stop with conflicts as a conflict before the infrastructure', () => {
		expect(cause_of('followup', RATE_LIMITED, ['src/a.ts'])).toBe(CAUSE.CONFLICT)
	})

	it('reads an empty conflict list as no conflict', () => {
		expect(cause_of('sync', 'merge failed', [])).toBe(CAUSE.CHECK)
	})
})

// joshuafolkken/kit#4166: a preflight stop records which preconditions it found unmet.
describe('run_ship_stop_cause.record_of — the ledger record of a stop', () => {
	it('carries every unmet precondition of a preflight stop beside its cause', () => {
		const preconditions = ['live-evidence', 'classification']

		expect(
			run_ship_stop_cause.record_of(7, 'preflight', { body: '2 unmet', preconditions }),
		).toStrictEqual({ issue: 7, reason: 'preflight', cause: CAUSE.CHECK, preconditions })
	})

	it('names no preconditions for a stop that carried none', () => {
		expect(
			run_ship_stop_cause.record_of(7, 'sync', { body: '', conflicts: ['a.ts'] }),
		).toStrictEqual({ issue: 7, reason: 'conflict', cause: CAUSE.CONFLICT })
	})

	it('records a stop that handed back no section as a check', () => {
		expect(run_ship_stop_cause.record_of(7, 'gate')).toStrictEqual({
			issue: 7,
			reason: 'gate',
			cause: CAUSE.CHECK,
		})
	})
})
