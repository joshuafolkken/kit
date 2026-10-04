import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { error_text } from './error-message'

describe('error_text.message_of', () => {
	it('returns the message of an Error', () => {
		expect(error_text.message_of(new Error('boom'))).toBe('boom')
	})

	it('returns a thrown string as it stands', () => {
		const thrown = 'plain failure'

		expect(error_text.message_of(thrown)).toBe(thrown)
	})

	it('stringifies a thrown value that is not an Error', () => {
		expect(error_text.message_of({ code: 1 })).toBe('[object Object]')
		expect(error_text.message_of(undefined)).toBe('undefined')
	})
})

describe('error_text.trace_swallowed', () => {
	const WHERE = 'run_hold.is_tree_dirty'
	let stderr_spy: MockInstance<typeof process.stderr.write>

	beforeEach(() => {
		stderr_spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('writes nothing when JOSH_DEBUG is unset', () => {
		vi.stubEnv('JOSH_DEBUG', undefined)
		error_text.trace_swallowed(WHERE, new Error('boom'))

		expect(stderr_spy).not.toHaveBeenCalled()
	})

	it('writes nothing when JOSH_DEBUG is blank', () => {
		vi.stubEnv('JOSH_DEBUG', ' ')
		error_text.trace_swallowed(WHERE, new Error('boom'))

		expect(stderr_spy).not.toHaveBeenCalled()
	})

	it('writes the place and the swallowed message to stderr when JOSH_DEBUG is set', () => {
		vi.stubEnv('JOSH_DEBUG', '1')
		error_text.trace_swallowed(WHERE, new Error('boom'))

		expect(stderr_spy).toHaveBeenCalledWith(`josh debug: ${WHERE}: boom\n`)
	})
})
