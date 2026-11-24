import { afterEach, describe, expect, it, vi } from 'vitest'
import { eslint_concurrency } from './eslint-concurrency'

const TWO_WORKERS = ['--concurrency', '2']

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('eslint_concurrency.concurrency_args', () => {
	it('passes a positive whole number to eslint', () => {
		expect(eslint_concurrency.concurrency_args('2')).toStrictEqual(TWO_WORKERS)
	})

	it.each([undefined, '', '0', '-1', 'auto', '2x', '1.5'])('adds nothing for %j', (value) => {
		expect(eslint_concurrency.concurrency_args(value)).toStrictEqual([])
	})
})

describe('eslint_concurrency.from_environment', () => {
	it('reads JOSH_ESLINT_CONCURRENCY', () => {
		vi.stubEnv('JOSH_ESLINT_CONCURRENCY', '2')

		expect(eslint_concurrency.from_environment()).toStrictEqual(TWO_WORKERS)
	})

	it('keeps the single worker when the variable is unset', () => {
		vi.stubEnv('JOSH_ESLINT_CONCURRENCY', undefined)

		expect(eslint_concurrency.from_environment()).toStrictEqual([])
	})
})
