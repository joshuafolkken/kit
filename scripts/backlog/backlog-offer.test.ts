import { describe, expect, it } from 'vitest'
import { backlog_next } from './backlog-next'
import { backlog_offer } from './backlog-offer'

const TOKENS = backlog_next.VERDICT_TOKENS
const NONE_TOKEN = TOKENS.complete
const OK_EXIT = 0
const FAILED_EXIT = 1
const NO_RUNNING = 0
const SOME_RUNNING = 2
const NO_RETRIES = 0
const ONE_RETRY = 1
const TWO_RETRIES = 2

function offer_of(
	tokens: ReadonlyArray<string>,
	running: number,
	retries: number,
): ReturnType<typeof backlog_offer.answer_of> {
	return backlog_offer.answer_of({ code: OK_EXIT, tokens }, running, retries)
}

describe('backlog_offer.answer_of — issue numbers become candidates', () => {
	it('maps one or more issue numbers to candidates and carries them as the issues to start', () => {
		expect(offer_of(['12', '13'], NO_RUNNING, NO_RETRIES)).toStrictEqual({
			answer: 'candidates',
			issues: ['12', '13'],
			retries: NO_RETRIES,
		})
	})

	it('resets the retry count when issue numbers arrive after a retry', () => {
		expect(offer_of(['12'], NO_RUNNING, TWO_RETRIES).retries).toBe(NO_RETRIES)
	})
})

describe('backlog_offer.answer_of — the verdict words map per the loop table', () => {
	it('maps `stop` to parked and `none` to exhausted', () => {
		expect(offer_of([TOKENS.stop], NO_RUNNING, NO_RETRIES).answer).toBe('parked')
		expect(offer_of([NONE_TOKEN], NO_RUNNING, NO_RETRIES).answer).toBe('exhausted')
	})

	it('maps `error` to unreadable', () => {
		expect(offer_of([TOKENS.error], NO_RUNNING, NO_RETRIES).answer).toBe('unreadable')
	})

	it('maps `wait` to blocked while children are in flight and exhausted when none are', () => {
		expect(offer_of([TOKENS.wait], SOME_RUNNING, NO_RETRIES).answer).toBe('blocked')
		expect(offer_of([TOKENS.wait], NO_RUNNING, NO_RETRIES).answer).toBe('exhausted')
	})

	it('reads an unrecognized token as unreadable rather than guessing', () => {
		expect(offer_of(['surprise'], NO_RUNNING, NO_RETRIES).answer).toBe('unreadable')
	})
})

describe('backlog_offer.answer_of — retry is blocked until the third consecutive one', () => {
	it('maps a retry below the limit to blocked and advances the count', () => {
		expect(offer_of([TOKENS.retry], NO_RUNNING, NO_RETRIES)).toStrictEqual({
			answer: 'blocked',
			issues: [],
			retries: ONE_RETRY,
		})
		expect(offer_of([TOKENS.retry], NO_RUNNING, ONE_RETRY).answer).toBe('blocked')
	})

	it('maps the third consecutive retry to unreadable', () => {
		expect(offer_of([TOKENS.retry], NO_RUNNING, TWO_RETRIES)).toStrictEqual({
			answer: 'unreadable',
			issues: [],
			retries: backlog_offer.RETRY_LIMIT,
		})
	})
})

describe('backlog_offer.answer_of — exit 1 is unreadable, never an empty backlog', () => {
	it('maps exit code 1 to unreadable rather than to the empty-backlog answer', () => {
		const offer = backlog_offer.answer_of({ code: FAILED_EXIT, tokens: [] }, NO_RUNNING, NO_RETRIES)

		expect(offer.answer).toBe('unreadable')
		expect(offer.answer).not.toBe('exhausted')
	})

	it('does not mistake a stray line on the exit-1 path for an issue number', () => {
		const offer = backlog_offer.answer_of(
			{ code: FAILED_EXIT, tokens: ['12'] },
			NO_RUNNING,
			NO_RETRIES,
		)

		expect(offer).toStrictEqual({ answer: 'unreadable', issues: [], retries: NO_RETRIES })
	})
})
