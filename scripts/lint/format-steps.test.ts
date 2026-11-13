import { describe, expect, it } from 'vitest'
import { format_steps } from './format-steps'

describe('format_steps.in_order', () => {
	it('finishes each writer before the next, preserving residual failures', async () => {
		const written: Array<string> = []
		const results = await format_steps.in_order(['eslint', 'prettier'], async (step) => {
			await Promise.resolve()
			written.push(step)

			return step === 'eslint' ? 1 : 0
		})

		expect(written).toEqual(['eslint', 'prettier'])
		expect(results).toEqual([1, 0])
	})
})
