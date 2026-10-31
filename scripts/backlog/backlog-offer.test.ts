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
			is_judgment_owed: false,
		})
	})

	it('maps issue numbers then a trailing triage to candidates that owe the judgment', () => {
		expect(offer_of(['12', TOKENS.triage], SOME_RUNNING, ONE_RETRY)).toStrictEqual({
			answer: 'candidates',
			issues: ['12'],
			retries: NO_RETRIES,
			is_judgment_owed: true,
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

	it('maps `triage` to untriaged', () => {
		expect(offer_of([TOKENS.triage], SOME_RUNNING, NO_RETRIES)).toStrictEqual({
			answer: 'untriaged',
			issues: [],
			retries: NO_RETRIES,
		})
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

// joshuafolkken/kit#4396: a `wait` the `run:solo` gate caused is marked, so `lane:stats` rows it apart.
const SOLO_NOTICE =
	'#12 carries `run:solo` and waits for joshuafolkken/kit’s running lanes to finish.'

function wait_with(error: string, running: number): ReturnType<typeof backlog_offer.answer_of> {
	return backlog_offer.answer_of(
		{ code: OK_EXIT, tokens: [TOKENS.wait], err: error },
		running,
		NO_RETRIES,
	)
}

describe('backlog_offer.answer_of — the run:solo cause', () => {
	it('marks a blocked wait whose stderr carries the run:solo notice as solo', () => {
		expect(wait_with(SOLO_NOTICE, SOME_RUNNING)).toStrictEqual({
			answer: 'blocked',
			issues: [],
			retries: NO_RETRIES,
			cause: 'solo',
		})
	})

	it('leaves a blocked wait for any other reason without a cause', () => {
		expect(wait_with('#12 is blocked by #11.', SOME_RUNNING).cause).toBeUndefined()
	})

	it('marks an exhausted wait the run:solo notice explains as solo', () => {
		expect(wait_with(SOLO_NOTICE, NO_RUNNING).cause).toBe('solo')
	})

	it('leaves a retry unmarked whatever its stderr says', () => {
		const read = { code: OK_EXIT, tokens: [TOKENS.retry], err: SOLO_NOTICE }

		expect(backlog_offer.answer_of(read, SOME_RUNNING, NO_RETRIES).cause).toBeUndefined()
	})
})

// joshuafolkken/kit#4513: a wait on a dependency chain or a start condition is marked with its issues.
const CHAIN_LINE = 'Waiting on a dependency chain: [#4496](https://github.com/o/r/issues/4496)'
const GATE_LINE = 'Waiting on a start condition: #4487'

describe('backlog_offer.answer_of — the chain and gate causes', () => {
	it('marks a blocked wait with its cause and the issues it waited on', () => {
		expect(wait_with(`${CHAIN_LINE}\n${GATE_LINE}`, SOME_RUNNING)).toStrictEqual({
			answer: 'blocked',
			issues: [],
			retries: NO_RETRIES,
			cause: 'chain+gate',
			waiting: [4496, 4487],
		})
	})

	it('lets the run:solo notice win over a cause line', () => {
		expect(wait_with(`${SOLO_NOTICE}\n${CHAIN_LINE}`, SOME_RUNNING).cause).toBe('solo')
	})

	// A wait with nothing in flight in this run — a start date, or a blocker another session holds.
	it('marks an exhausted wait with its cause and issues too', () => {
		expect(wait_with(GATE_LINE, NO_RUNNING)).toStrictEqual({
			answer: 'exhausted',
			issues: [],
			retries: NO_RETRIES,
			cause: 'gate',
			waiting: [4487],
		})
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
