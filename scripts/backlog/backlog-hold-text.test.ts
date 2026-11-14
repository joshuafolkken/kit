import { describe, expect, it } from 'vitest'
import { backlog_hold_text } from './backlog-hold-text'

const { text_of } = backlog_hold_text
const AWAIT_TRIAGE = 'open issues await your triage'
const AS_SENTENCE = 'reads %s as a sentence'
const JUDGE = 'hand-back:judge'
const WINDOW = 'hand-back:window'
const DRAINED = 'hand-back:drained'

describe('backlog_hold_text.text_of — hand-back holds', () => {
	it.each([
		[JUDGE, AWAIT_TRIAGE],
		['hand-back:triage', 'a parked issue awaits your triage'],
		['hand-back:merge', 'the driver paused after a merge; the session restarts it'],
		['hand-back:launch', 'a lane launch failed; the session restarts the driver'],
		['hand-back:offer', 'the backlog offer failed; the session restarts the driver'],
		[WINDOW, "the run's time window closed; the session restarts the driver"],
		[DRAINED, 'the backlog had nothing to start; the session restarts the driver'],
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
		['offer:wait:chain', 'queued issues wait on other issues'],
		['offer:wait:gate', 'queued issues wait on a start condition'],
		['offer:watch:chain+gate', 'queued issues wait on other issues or a start condition'],
		['offer:watch:lane', 'queued issues wait on a running lane'],
		['offer:watch:gate+lane', 'queued issues wait on a start condition or a running lane'],
		['offer:wait:blocked', 'every queued issue is blocked'],
		['offer:wait:exhausted', 'the backlog has nothing left to start'],
		['offer:wait:untriaged', AWAIT_TRIAGE],
		['offer:wait:parked', 'parked issues await your decision'],
		['offer:wait:unreadable', 'the backlog could not be read'],
		['offer:wait', 'the backlog is waiting (wait)'],
		['offer:watch:other', 'the backlog is waiting (watch:other)'],
	])(AS_SENTENCE, (code, text) => {
		expect(text_of(code)).toBe(text)
	})
})

describe('backlog_hold_text.text_of — whole-code holds', () => {
	it.each([
		['memory', 'memory pressure is high; lanes resume when it eases'],
		['usage-limit', 'the usage limit is reached; lanes resume when it resets'],
	])(AS_SENTENCE, (code, text) => {
		expect(text_of(code)).toBe(text)
	})

	it.each(['pause:other', 'offer', 'hand-back'])('shows the unknown code %s as is', (code) => {
		expect(text_of(code)).toBe(code)
	})
})
