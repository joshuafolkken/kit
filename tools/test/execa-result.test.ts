import { describe, expect, it } from 'vitest'
import { fake_result } from './execa-result'

describe('fake_result', () => {
	it('carries the exit code and the combined output', () => {
		const result = fake_result(1, 'failed\n')

		expect(result.exitCode).toBe(1)
		expect(result.all).toBe('failed\n')
	})

	it('defaults the combined output to empty and keeps an absent exit code absent', () => {
		const result = fake_result(undefined)

		expect(result.exitCode).toBeUndefined()
		expect(result.all).toBe('')
	})
})
