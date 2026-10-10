import { describe, expect, it } from 'vitest'
import { run_board_fetch } from './run-board-fetch'

const { launch } = run_board_fetch
const FAILED = 'failed'

// A read that never answers.
async function never(): Promise<string> {
	return await new Promise(() => undefined)
}

async function rejecting(): Promise<string> {
	throw new Error('offline')
}

describe('run_board_fetch.launch', () => {
	it('has no answer while the read is in flight', () => {
		expect(launch(never, FAILED).answer()).toBeUndefined()
	})

	it('keeps the value once the read lands', async () => {
		const fetch = launch(async () => 'plan', FAILED)

		await fetch.landed

		expect(fetch.answer()).toEqual({ value: 'plan' })
	})

	it('answers the failed value for a rejected read without rejecting', async () => {
		const fetch = launch(rejecting, FAILED)

		await expect(fetch.landed).resolves.toBeUndefined()
		expect(fetch.answer()).toEqual({ value: FAILED })
	})
})
