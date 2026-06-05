import { describe, expect, it } from 'vitest'
import { get_exit_code } from './git-execa-error'

describe('get_exit_code', () => {
	it('returns the numeric exitCode from an execa-like error', () => {
		const error = Object.assign(new Error('failed'), { exitCode: 128 })

		expect(get_exit_code(error)).toBe(128)
	})

	it('returns undefined when exitCode is not a number (signal termination)', () => {
		const error = Object.assign(new Error('killed'), { exitCode: undefined })

		expect(get_exit_code(error)).toBeUndefined()
	})

	it('returns undefined for an error without an exitCode field', () => {
		expect(get_exit_code(new Error('plain'))).toBeUndefined()
	})

	it('returns undefined for a non-object value', () => {
		expect(get_exit_code('not an error')).toBeUndefined()
	})
})
