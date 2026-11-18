import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { test_related_caller } from './test-related-caller'

// joshuafolkken/kit#7965: who started a `test:related` run, carried to it in the environment.

const { CALLER_ENVIRONMENT, MANUAL } = test_related_caller
const CHAIN = 'run:chain check:related'
const saved: { value?: string | undefined } = {}

beforeEach(() => {
	saved.value = process.env[CALLER_ENVIRONMENT]
	Reflect.deleteProperty(process.env, CALLER_ENVIRONMENT)
})

afterEach(() => {
	if (saved.value === undefined) Reflect.deleteProperty(process.env, CALLER_ENVIRONMENT)
	else process.env[CALLER_ENVIRONMENT] = saved.value
})

describe('test_related_caller.read', () => {
	it('reads a run nobody named as manual', () => {
		expect(test_related_caller.read()).toBe(MANUAL)
		process.env[CALLER_ENVIRONMENT] = ''
		expect(test_related_caller.read()).toBe(MANUAL)
	})

	it('reads the caller its environment names', () => {
		process.env[CALLER_ENVIRONMENT] = CHAIN
		expect(test_related_caller.read()).toBe(CHAIN)
	})

	it('names the caller for a child process', () => {
		expect(test_related_caller.environment(CHAIN)).toStrictEqual({ [CALLER_ENVIRONMENT]: CHAIN })
	})
})
