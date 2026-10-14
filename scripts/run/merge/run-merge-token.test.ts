import { describe, expect, it } from 'vitest'
import { run_merge_token } from './run-merge-token'

const { MERGE_TOKEN } = run_merge_token
const TOKENS = Object.values(MERGE_TOKEN)

describe('run_merge_token.MERGE_TOKEN', () => {
	it('declares the verdict vocabulary run:merge prints', () => {
		expect(MERGE_TOKEN).toEqual({
			OVER: 'over',
			HUMAN_REVIEW: 'human-review',
			BUSY: 'busy',
			STOP: 'stop',
			ENVIRONMENT: 'environment',
			RETRY: 'retry',
			RESUMED: 'resumed',
		})
	})

	it('gives every verdict a distinct token', () => {
		expect(new Set(TOKENS).size).toBe(TOKENS.length)
	})

	it.each(TOKENS)('prints %s as a single stdout word', (token) => {
		expect(token).toMatch(/^[a-z]+(?:-[a-z]+)*$/u)
	})
})

describe('run_merge_token.is_control_stop', () => {
	it.each([
		['the control stop', MERGE_TOKEN.STOP, false, true],
		['the stop an offer passed through, left to backlog:budget', MERGE_TOKEN.STOP, true, false],
		['any other control verdict', MERGE_TOKEN.OVER, false, false],
	])('reads %s', (_label, token, is_offer, expected) => {
		expect(run_merge_token.is_control_stop({ token, is_offer })).toBe(expected)
	})
})
