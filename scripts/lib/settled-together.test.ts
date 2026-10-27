import { describe, expect, it } from 'vitest'
import { settled_together } from './settled-together'

const FIRST_ERROR = new Error('first')
const SECOND_ERROR = new Error('second')

describe('settled_together', () => {
	it('resolves when both steps resolve', async () => {
		await expect(settled_together(Promise.resolve(), Promise.resolve())).resolves.toBeUndefined()
	})

	it('waits for the other step before throwing a failure', async () => {
		let is_other_done = false

		async function other(): Promise<void> {
			await Promise.resolve()
			is_other_done = true
		}

		await expect(settled_together(Promise.reject(FIRST_ERROR), other())).rejects.toBe(FIRST_ERROR)
		expect(is_other_done).toBe(true)
	})

	it('throws the second step failure when the first resolved', async () => {
		await expect(settled_together(Promise.resolve(), Promise.reject(SECOND_ERROR))).rejects.toBe(
			SECOND_ERROR,
		)
	})

	it('throws the first step failure when both failed', async () => {
		await expect(
			settled_together(Promise.reject(FIRST_ERROR), Promise.reject(SECOND_ERROR)),
		).rejects.toBe(FIRST_ERROR)
	})
})
