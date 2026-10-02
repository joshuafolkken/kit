import { describe, expect, it } from 'vitest'
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
