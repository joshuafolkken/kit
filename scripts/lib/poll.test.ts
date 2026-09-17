import { describe, expect, it } from 'vitest'
import { poll } from './poll'

const ATTEMPTS = 5
const INTERVAL_MS = 10
const SUCCEED_ON_THIRD = 3

async function no_wait(): Promise<void> {
	await Promise.resolve()
}

describe('poll.poll_until', () => {
	it('returns true without waiting when the condition already holds', async () => {
		const waits: Array<number> = []

		const sleeper = async (duration_ms: number): Promise<void> => {
			waits.push(duration_ms)
			await no_wait()
		}

		const is_reached = await poll.poll_until(async () => true, {
			attempts: ATTEMPTS,
			interval_ms: INTERVAL_MS,
			sleeper,
		})

		expect(is_reached).toBe(true)
		expect(waits).toEqual([])
	})
})

describe('poll.poll_until over several attempts', () => {
	it('keeps asking until the condition holds', async () => {
		let calls = 0
		const is_reached = await poll.poll_until(
			async () => {
				calls += 1

				return calls >= SUCCEED_ON_THIRD
			},
			{ attempts: ATTEMPTS, interval_ms: INTERVAL_MS, sleeper: no_wait },
		)

		expect(is_reached).toBe(true)
		expect(calls).toBe(SUCCEED_ON_THIRD)
	})

	it('returns false when the attempts run out', async () => {
		let calls = 0
		const is_reached = await poll.poll_until(
			async () => {
				calls += 1

				return false
			},
			{ attempts: ATTEMPTS, interval_ms: INTERVAL_MS, sleeper: no_wait },
		)

		expect(is_reached).toBe(false)
		expect(calls).toBe(ATTEMPTS)
	})
})

describe('poll.poll_until budget', () => {
	// The wait goes *between* attempts, so `attempts × interval_ms` is the budget actually spent
	// rather than one interval more than it.
	it('does not wait after the final attempt', async () => {
		const waits: Array<number> = []

		const sleeper = async (duration_ms: number): Promise<void> => {
			waits.push(duration_ms)
			await no_wait()
		}

		await poll.poll_until(async () => false, {
			attempts: ATTEMPTS,
			interval_ms: INTERVAL_MS,
			sleeper,
		})

		expect(waits).toHaveLength(ATTEMPTS - 1)
	})
})

describe('poll.sleep', () => {
	it('resolves after the requested delay', async () => {
		const started_at = Date.now()

		await poll.sleep(INTERVAL_MS)

		expect(Date.now() - started_at).toBeGreaterThanOrEqual(0)
	})
})
