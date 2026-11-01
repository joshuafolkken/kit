import { api_auth } from '#scripts/agent/api-auth'
import { UNREADABLE_COMMENTS_STOP } from '#scripts/gh/git-gh-comments-unreadable'
import { MERGE_UNCONFIRMED_MESSAGE } from '#scripts/gh/git-gh-pr'
import { gh_retry } from '#scripts/gh/git-gh-retry'
import { NO_CHECKS_MESSAGE } from '#scripts/gh/git-pr-checks-watch'
import { git_error } from '#scripts/git/git-error'
import { describe, expect, it } from 'vitest'
import { run_ship_stop_cause } from './run-ship-stop-cause'

// joshuafolkken/kit#3998: a ship stop names why it stopped, and only a stop on the infrastructure is
// worth re-running in place.

const { CAUSE, cause_of } = run_ship_stop_cause
const RATE_LIMITED = 'CodeRabbit: Review rate limit exceeded'
const MEDIUM_KIND = 'bug-risks:medium'
const MEDIUM_SPEC = `${MEDIUM_KIND}:a.ts`

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

const RED_CHECK = 'CI / test failed'

// joshuafolkken/kit#5012: a merge gate that stopped on reviewer comments it could not read is a read to
// retry, read on the note the gate prints to the standard output, whatever gh's own reason said.
describe('run_ship_stop_cause.cause_of — an unreadable comment listing', () => {
	const STOPPED = `⚠️ ${UNREADABLE_COMMENTS_STOP}`

	it('reads a followup the unreadable comments stopped as the infrastructure', () => {
		const failed = { body: `${STOPPED}\n❌ Error: comments could not be read`, out: STOPPED }

		expect(cause_of('followup', failed)).toBe(CAUSE.INFRA)
	})

	it('reads it as a check when only the standard error names it', () => {
		expect(cause_of('followup', { body: STOPPED, out: RED_CHECK })).toBe(CAUSE.CHECK)
	})
})

// joshuafolkken/kit#4589: a failed stage's body carries its stderr, where a poll warns of a transient
// rate limit it then recovered from.
describe('run_ship_stop_cause.cause_of — the standard output a stage kept', () => {
	it('reads a red check whose stderr names a rate limit as a check', () => {
		const failed = { body: `${RED_CHECK}\n${RATE_LIMITED}`, out: RED_CHECK }

		expect(cause_of('followup', failed)).toBe(CAUSE.CHECK)
	})
})

// joshuafolkken/kit#5052: a request gh found transient to its last attempt notes so on stderr alone.
describe('run_ship_stop_cause.cause_of — a gh request whose retries ran out', () => {
	const EMPTY_ANSWER = 'unexpected end of JSON input'
	const RETRY_NOTE = `gh: request failed transiently (attempt 1/3: ${EMPTY_ANSWER}) — retrying in 2000 ms`
	const SPENT = gh_retry.spent_note(EMPTY_ANSWER)
	const { DETAILS_PREFIX, FAILURE_PREFIX } = git_error

	it('reads a followup stopped on it as the infrastructure, though its stdout names none', () => {
		const failed = { body: `${RETRY_NOTE}\n${SPENT}\n${FAILURE_PREFIX} ${EMPTY_ANSWER}`, out: '' }

		expect(cause_of('followup', failed)).toBe(CAUSE.INFRA)
	})

	it('reads a red check whose stderr notes only a recovered retry as a check', () => {
		expect(cause_of('followup', { body: `${RETRY_NOTE}\n${RED_CHECK}`, out: RED_CHECK })).toBe(
			CAUSE.CHECK,
		)
	})

	it('reads a followup stopped on a failure caused by it as the infrastructure', () => {
		const unconfirmed = `${FAILURE_PREFIX} ${MERGE_UNCONFIRMED_MESSAGE}\n\n${DETAILS_PREFIX} ${EMPTY_ANSWER}`

		expect(cause_of('followup', { body: `${SPENT}\n${unconfirmed}`, out: '' })).toBe(CAUSE.INFRA)
	})

	it('reads a red check stopped on after a caught spent request as a check', () => {
		const body = `${SPENT}\n${RED_CHECK}\n${FAILURE_PREFIX} ${RED_CHECK}`

		expect(cause_of('followup', { body, out: RED_CHECK })).toBe(CAUSE.CHECK)
	})
})

// joshuafolkken/kit#4825: the commit and followup stages gate a merged tree themselves.
describe('run_ship_stop_cause.cause_of — a stop tagged as a check', () => {
	it.each(['commit', 'followup'] as const)(
		'reads a %s stop tagged as a check as one, whatever its output names',
		(stage) => {
			expect(cause_of(stage, { body: RATE_LIMITED, cause: CAUSE.CHECK })).toBe(CAUSE.CHECK)
		},
	)
})

describe('run_ship_stop_cause.cause_of — every stop that is not the infrastructure', () => {
	it('reads a followup on a red check as a check', () => {
		expect(cause_of('followup', { body: RED_CHECK })).toBe(CAUSE.CHECK)
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
				findings: [MEDIUM_KIND],
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

// joshuafolkken/kit#4519: a review stop hands each deciding finding, whole, to the durable stop log.
describe('run_ship_stop_cause.details_of — the findings of a review stop, whole', () => {
	it('carries the file:line and first sentence of each deciding finding', () => {
		const body = `${MEDIUM_SPEC}:3 — stale. More.\ntests:low:b.ts\nreview found High/Medium`

		expect(run_ship_stop_cause.details_of('review', { body })).toStrictEqual([
			{ kind: MEDIUM_KIND, location: 'a.ts:3', sentence: 'stale.' },
		])
	})

	it.each([
		['review', `${api_auth.AUTH_FAILURE_NOTE}\n${MEDIUM_SPEC}`],
		['gate', MEDIUM_SPEC],
	] as const)('names no finding for a %s stop no finding decided', (stage, body) => {
		expect(run_ship_stop_cause.details_of(stage, { body })).toStrictEqual([])
	})

	it('names no finding for a stop with no output', () => {
		expect(run_ship_stop_cause.details_of('review')).toStrictEqual([])
	})
})

// joshuafolkken/kit#5780: a timed-out merge wait logs what it was blocked on under its failure.
describe('run_ship_stop_cause.blocked_cause_of — the block a timed-out wait named', () => {
	const TIMEOUT = `${git_error.FAILURE_PREFIX} Timed out while waiting for PR checks to complete.`

	it('reads the cause logged under the failure the stage ended on', () => {
		const body = `${TIMEOUT}\n\n${git_error.DETAILS_PREFIX} BLOCKED: Checks missing\n`

		expect(run_ship_stop_cause.blocked_cause_of(body)).toBe('BLOCKED: Checks missing')
	})

	it('reads none from a failure with no blocked cause', () => {
		expect(run_ship_stop_cause.blocked_cause_of(`${TIMEOUT}\n`)).toBeUndefined()
		expect(run_ship_stop_cause.blocked_cause_of(RED_CHECK)).toBeUndefined()
	})
})
