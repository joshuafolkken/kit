import { describe, expect, it, vi } from 'vitest'
import type { ShipSection } from './run-ship'
import { run_ship_infra_retry, type RetryHooks } from './run-ship-infra-retry'

// joshuafolkken/kit#3998: a stage that stopped on the infrastructure runs again in place, at most
// `MAX_INFRA_RETRIES` times; any other stop returns at once.

const { MAX_INFRA_RETRIES, RETRY_DELAY_MS, retried } = run_ship_infra_retry
const HEADER = 'followup'
const RATE_LIMITED: ShipSection = { header: HEADER, body: 'Review rate limit exceeded', code: 1 }
const RED: ShipSection = { header: HEADER, body: 'CI / test failed', code: 1 }
const GREEN: ShipSection = { header: HEADER, body: 'merged', code: 0 }

function hooks(): RetryHooks & { waits: Array<number>; notes: Array<string> } {
	const waits: Array<number> = []
	const notes: Array<string> = []

	return {
		waits,
		notes,
		wait: async (milliseconds) => {
			waits.push(milliseconds)
		},
		note: (text) => {
			notes.push(text)
		},
	}
}

function attempts(...sections: Array<ShipSection>): () => Promise<ShipSection> {
	const queue = [...sections]

	return vi.fn(async () => queue.shift() ?? GREEN)
}

describe('run_ship_infra_retry.retried', () => {
	it('returns a green stage after one run', async () => {
		const attempt = attempts(GREEN)

		await expect(retried('followup', attempt, hooks())).resolves.toBe(GREEN)
		expect(attempt).toHaveBeenCalledTimes(1)
	})

	it('re-runs a stage the infrastructure stopped until it passes', async () => {
		const recorded = hooks()
		const attempt = attempts(RATE_LIMITED, GREEN)

		await expect(retried('followup', attempt, recorded)).resolves.toBe(GREEN)
		expect(attempt).toHaveBeenCalledTimes(2)
		expect(recorded.waits).toStrictEqual([RETRY_DELAY_MS])
		expect(recorded.notes).toStrictEqual([
			`josh ship: followup stopped on the infrastructure — retry 1/${String(MAX_INFRA_RETRIES)}`,
		])
	})

	it('stops on the infrastructure once the retries run out', async () => {
		const attempt = attempts(RATE_LIMITED, RATE_LIMITED, RATE_LIMITED, GREEN)

		await expect(retried('followup', attempt, hooks())).resolves.toBe(RATE_LIMITED)
		expect(attempt).toHaveBeenCalledTimes(MAX_INFRA_RETRIES + 1)
	})

	it('never re-runs a red check', async () => {
		const recorded = hooks()
		const attempt = attempts(RED, GREEN)

		await expect(retried('followup', attempt, recorded)).resolves.toBe(RED)
		expect(attempt).toHaveBeenCalledTimes(1)
		expect(recorded.waits).toStrictEqual([])
	})

	it('never re-runs a review, whatever its findings name', async () => {
		const attempt = attempts({ ...RATE_LIMITED, header: 'review' }, GREEN)

		await retried('review', attempt, hooks())
		expect(attempt).toHaveBeenCalledTimes(1)
	})
})
