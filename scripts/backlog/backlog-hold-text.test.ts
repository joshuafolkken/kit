import { describe, expect, it } from 'vitest'
import { backlog_hold_text } from './backlog-hold-text'

const { text_of } = backlog_hold_text
const AWAIT_TRIAGE = 'open issues await your triage'
const AS_SENTENCE = 'reads %s as a sentence'
const JUDGE = 'hand-back:judge'
const WINDOW = 'hand-back:window'
const DRAINED = 'hand-back:drained'
const USAGE_LIMIT = 'the usage limit is reached; lanes resume when it resets'
const USAGE_LIMIT_CODE = 'usage-limit'
const RE_LOGIN = 'claude auth login'

describe('backlog_hold_text.text_of — hand-back holds', () => {
	it.each([
		[JUDGE, AWAIT_TRIAGE],
		['hand-back:triage', 'a parked issue awaits your triage'],
		['hand-back:merge', 'the driver paused after a merge; the session restarts it'],
		['hand-back:launch', 'a lane launch failed; the session restarts the driver'],
		['hand-back:offer', 'the backlog offer failed; the session restarts the driver'],
		// joshuafolkken/kit#9003: the supervisor, not a session, re-drives a window's end.
		[WINDOW, "the run's time window closed; the supervisor restarts the driver"],
		[DRAINED, 'the backlog had nothing to start; the supervisor restarts the driver'],
		['hand-back:crash', 'the driver paused (crash); the session restarts it'],
	])(AS_SENTENCE, (code, text) => {
		expect(text_of(code)).toBe(text)
	})

	it('reads a driverless hand-back as the missing driver before the mark’s own sentence', () => {
		expect(text_of('driverless:hand-back:judge')).toBe(`no driver is running; ${AWAIT_TRIAGE}`)
	})
})

// joshuafolkken/kit#7510: a hand-back a session restart ends, apart from one a person ends.
describe('backlog_hold_text.is_driver_restart', () => {
	it.each([
		[WINDOW, true],
		[DRAINED, true],
		['driverless:hand-back:merge', true],
		[JUDGE, false],
		['driverless:hand-back:triage', false],
		['offer:watch:chain', false],
		['memory', false],
	])('reads %s as %s', (code, expected) => {
		expect(backlog_hold_text.is_driver_restart(code)).toBe(expected)
	})
})

describe('backlog_hold_text.text_of — offer holds', () => {
	it.each([
		['offer:watch:solo', 'a run:solo issue must finish first'],
		['offer:watch:decision', 'an interrupt defect awaits your decision'],
		['offer:wait:chain', 'queued issues wait on other issues'],
		['offer:wait:gate', 'queued issues wait on a start condition'],
		['offer:watch:chain+gate', 'queued issues wait on other issues or a start condition'],
		['offer:watch:lane', 'queued issues wait on a running lane'],
		['offer:watch:gate+lane', 'queued issues wait on a start condition or a running lane'],
		['offer:watch:publication', 'queued issues wait on their publication'],
		['offer:wait:blocked', 'every queued issue is blocked'],
		['offer:wait:exhausted', 'the backlog has nothing left to start'],
		['offer:wait:untriaged', AWAIT_TRIAGE],
		['offer:wait:parked', 'parked issues await your decision'],
		['offer:wait:unreadable', 'the backlog could not be read'],
		['offer:wait:named:8845', 'named #8845 runs first; the auto-ok queue starts when it ends'],
		['offer:wait:only', 'the run closes once its named issues finish'],
		['offer:wait', 'the backlog is waiting (wait)'],
		['offer:watch:other', 'the backlog is waiting (watch:other)'],
	])(AS_SENTENCE, (code, text) => {
		expect(text_of(code)).toBe(text)
	})
})

describe('backlog_hold_text.text_of — whole-code holds', () => {
	it.each([
		['memory', 'memory pressure is high; lanes resume when it eases'],
		[
			'main-dirty',
			'the primary checkout has uncommitted changes; lanes resume once it is committed, stashed or held by a run',
		],
		[USAGE_LIMIT_CODE, USAGE_LIMIT],
	])(AS_SENTENCE, (code, text) => {
		expect(text_of(code)).toBe(text)
	})

	// joshuafolkken/kit#8014: an authentication failure holds under the usage-limit code.
	it('reads a usage-limit hold an authentication failure caused as that failure and its re-login', () => {
		const text = text_of(USAGE_LIMIT_CODE, 'auth')

		expect(text).not.toContain('usage limit')
		expect(text).toContain(RE_LOGIN)
		expect(text).toContain('CLAUDE_CODE_OAUTH_TOKEN')
	})

	it('keeps the usage-limit sentence for a limit, and for a driverless mark the cause reaches', () => {
		expect(text_of(USAGE_LIMIT_CODE, 'limit')).toBe(USAGE_LIMIT)
		expect(text_of(`driverless:${USAGE_LIMIT_CODE}`, 'auth')).toContain(RE_LOGIN)
	})

	it.each(['pause:other', 'offer', 'hand-back'])('shows the unknown code %s as is', (code) => {
		expect(text_of(code)).toBe(code)
	})
})
