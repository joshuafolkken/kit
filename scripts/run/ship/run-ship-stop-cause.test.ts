import { api_auth } from '#scripts/agent/api-auth'
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
		expect(cause_of('followup', { body: output })).toBe(CAUSE.INFRA)
	})

	it.each(['sync', 'commit', 'report'] as const)(
		'reads a %s stop for the infrastructure',
		(stage) => {
			expect(cause_of(stage, { body: RATE_LIMITED })).toBe(CAUSE.INFRA)
		},
	)
})

describe('run_ship_stop_cause.cause_of — every stop that is not the infrastructure', () => {
	it('reads a followup on a red check as a check', () => {
		expect(cause_of('followup', { body: 'CI / test failed' })).toBe(CAUSE.CHECK)
	})

	it.each(['gate', 'preflight'] as const)(
		'never reads a %s stop as the infrastructure, whatever its output names',
		(stage) => {
			expect(cause_of(stage, { body: `✗ retries after a ${RATE_LIMITED}` })).toBe(CAUSE.CHECK)
		},
	)

	it.each(['review', 'round-2'] as const)('reads an untagged %s stop as a finding', (stage) => {
		expect(cause_of(stage, { body: RATE_LIMITED })).toBe(CAUSE.FINDING)
	})

	it.each([
		`isolated reviewer failed: the broker answered a failure: ${api_auth.AUTH_FAILURE_NOTE}: the reviewer exited with code 1`,
		`${api_auth.AUTH_FAILURE_NOTE}: reviewer failed — log: /tmp/review.log`,
	])('reads a review stop on a reviewer that could not authenticate as auth', (output) => {
		expect(cause_of('review', { body: output })).toBe(CAUSE.AUTH)
	})

	it('keeps a finding that quotes the authentication note mid-line a finding', () => {
		expect(
			cause_of('review', { body: `High: the text ${api_auth.AUTH_FAILURE_NOTE} is wrong` }),
		).toBe(CAUSE.FINDING)
	})

	it('reads a stop with conflicts as a conflict before the infrastructure', () => {
		expect(cause_of('followup', { body: RATE_LIMITED, conflicts: ['src/a.ts'] })).toBe(
			CAUSE.CONFLICT,
		)
	})

	it('reads an empty conflict list as no conflict', () => {
		expect(cause_of('sync', { body: 'merge failed', conflicts: [] })).toBe(CAUSE.CHECK)
	})
})

// joshuafolkken/kit#4431: a review round's stop on no finding is recorded under the cause its step tagged.
describe('run_ship_stop_cause.cause_of — a review stop its step tagged', () => {
	it.each([CAUSE.CHECK, CAUSE.INFRA, CAUSE.ATTEST])(
		'reads a review stop tagged %s under that cause, not as a finding',
		(cause) => {
			expect(cause_of('review', { body: 'Gate RED', cause })).toBe(cause)
			expect(cause_of('round-2', { body: 'Gate RED', cause })).toBe(cause)
		},
	)

	it('reads a tagged stop on a reviewer that could not authenticate as auth', () => {
		const body = `isolated reviewer failed: ${api_auth.AUTH_FAILURE_NOTE}`

		expect(cause_of('review', { body, cause: CAUSE.INFRA })).toBe(CAUSE.AUTH)
	})

	it('ignores a tag on a stage that is no review round', () => {
		expect(cause_of('gate', { body: 'red', cause: CAUSE.ATTEST })).toBe(CAUSE.CHECK)
	})

	it('records the tagged cause in the ledger record', () => {
		expect(
			run_ship_stop_cause.record_of(7, 'review', { body: 'refused', cause: CAUSE.ATTEST }),
		).toStrictEqual({ issue: 7, reason: 'review', cause: CAUSE.ATTEST })
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

// joshuafolkken/kit#4426: a review stop records the kind of each blocking finding it listed.
describe('run_ship_stop_cause.record_of — the finding kinds of a review stop', () => {
	it.each(['review', 'round-2'] as const)(
		'carries the blocking finding kinds of a %s stop beside its cause',
		(stage) => {
			const body = 'bug-risks:medium:a.ts:3 — stale\ntests:low:b.ts\nreview found High/Medium'

			expect(run_ship_stop_cause.record_of(7, stage, { body })).toStrictEqual({
				issue: 7,
				reason: stage,
				cause: CAUSE.FINDING,
				findings: ['bug-risks:medium'],
			})
		},
	)

	it('carries the fixed finding kinds of a stop its fixes decided', () => {
		const body = 'fixed tests:medium:a.ts — no row\nreview fixes did not pass the scoped checks'

		expect(run_ship_stop_cause.record_of(7, 'review', { body })).toHaveProperty('findings', [
			'tests:medium',
		])
	})

	it.each([
		['review', `${api_auth.AUTH_FAILURE_NOTE}\nbug-risks:medium:a.ts`],
		['gate', 'bug-risks:medium:a.ts'],
		['review', 'Gate RED — the review verdict is blocked'],
	] as const)('names no finding kinds for a %s stop no finding decided', (stage, body) => {
		expect(run_ship_stop_cause.record_of(7, stage, { body })).not.toHaveProperty('findings')
	})
})
