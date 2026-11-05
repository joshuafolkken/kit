import { describe, expect, it, vi } from 'vitest'

const RESULT = 'retained implementation'
const shared_mock = vi.fn(() => RESULT)

describe('automatic mock history cleanup', () => {
	it('records a call using the shared implementation', () => {
		expect(shared_mock()).toBe(RESULT)
		expect(shared_mock).toHaveBeenCalledOnce()
	})

	it('clears the previous call while preserving the implementation', () => {
		expect(shared_mock).not.toHaveBeenCalled()
		expect(shared_mock()).toBe(RESULT)
		expect(shared_mock).toHaveBeenCalledOnce()
	})
})
