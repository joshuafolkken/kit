import { describe, expect, it } from 'vitest'
import { poll, POLL_BACKOFF, PR_POLL_SCHEDULES, type BackoffSchedule } from './poll'

const ATTEMPTS = 5
const INTERVAL_MS = 10
const SUCCEED_ON_THIRD = 3
const MANY_READS = 50

function never_answers(): string | undefined {
	return undefined
}

async function no_wait(): Promise<void> {
	await Promise.resolve()
}

describe('poll.poll_until', () => {
	it('returns true without waiting when the condition already holds', async () => {
		const waits: Array<number> = []

		async function sleeper(duration_ms: number): Promise<void> {
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

		async function sleeper(duration_ms: number): Promise<void> {
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

describe('poll.poll_for', () => {
	it('answers the first value the read gives', async () => {
		let calls = 0
		const value = await poll.poll_for(
			() => {
				calls += 1

				return calls >= SUCCEED_ON_THIRD ? `read ${String(calls)}` : undefined
			},
			{ attempts: ATTEMPTS, interval_ms: INTERVAL_MS, sleeper: no_wait },
		)

		expect(value).toBe('read 3')
	})

	it('answers undefined when the attempts run out', async () => {
		const value = await poll.poll_for(never_answers, {
			attempts: ATTEMPTS,
			interval_ms: INTERVAL_MS,
			sleeper: no_wait,
		})

		expect(value).toBeUndefined()
	})

	it('answers a falsy value rather than reading it as not yet', async () => {
		const is_answered = await poll.poll_for(() => false, {
			attempts: ATTEMPTS,
			interval_ms: INTERVAL_MS,
			sleeper: no_wait,
		})

		expect(is_answered).toBe(false)
	})
})

describe('poll.wait_for', () => {
	// No attempt budget: the read alone ends the wait, however many reads that takes.
	it('keeps reading past any attempt count until the read answers', async () => {
		let calls = 0
		const value = await poll.wait_for(
			() => {
				calls += 1

				return calls >= MANY_READS ? calls : undefined
			},
			{ interval_ms: INTERVAL_MS, sleeper: no_wait },
		)

		expect(value).toBe(MANY_READS)
	})

	it('waits the interval between reads', async () => {
		const waits: Array<number> = []
		let calls = 0

		async function sleeper(duration_ms: number): Promise<void> {
			waits.push(duration_ms)
			await no_wait()
		}

		await poll.wait_for(
			() => {
				calls += 1

				return calls >= SUCCEED_ON_THIRD ? true : undefined
			},
			{ interval_ms: INTERVAL_MS, sleeper },
		)

		expect(waits).toEqual([INTERVAL_MS, INTERVAL_MS])
	})
})

// #6719: a CI wait reads mostly unchanged state, so the interval lengthens until something moves.
describe('poll.poll_for backoff', () => {
	const BACKOFF_ATTEMPTS = 20
	const FIXED_INTERVAL_MS = 30_000
	const BUDGET_MS = (BACKOFF_ATTEMPTS - 1) * FIXED_INTERVAL_MS

	async function waits_over(seen_per_tick: ReadonlyArray<string>): Promise<Array<number>> {
		const waits: Array<number> = []
		let tick = 0

		await poll.poll_for(never_answers, {
			attempts: BACKOFF_ATTEMPTS,
			interval_ms: FIXED_INTERVAL_MS,
			sleeper: async (duration_ms) => {
				waits.push(duration_ms)
				tick += 1
				await no_wait()
			},
			backoff: { seen: () => seen_per_tick[tick] ?? 'same' },
		})

		return waits
	}

	it('lengthens the wait by 1.5 per unchanged tick and stops at 120 seconds', async () => {
		const waits = await waits_over([])

		expect(POLL_BACKOFF).toEqual({ initial_ms: 30_000, factor: 1.5, max_ms: 120_000 })
		expect(waits.slice(0, 6)).toEqual([30_000, 45_000, 67_500, 101_250, 120_000, 120_000])
	})

	it('goes back to the first interval after a tick that changed', async () => {
		const waits = await waits_over(['a', 'a', 'a', 'b', 'b'])

		expect(waits.slice(0, 5)).toEqual([30_000, 45_000, 67_500, 30_000, 45_000])
	})

	it('spends the same total wait as the fixed cadence, the last wait cut to what is left', async () => {
		const waits = await waits_over([])
		const total_ms = waits.reduce((sum, wait_ms) => sum + wait_ms, 0)

		expect(total_ms).toBe(BUDGET_MS)
		expect(waits.at(-1)).toBeLessThanOrEqual(POLL_BACKOFF.max_ms)
	})
})

async function first_waits_of(
	schedule: BackoffSchedule,
	seen_per_tick: ReadonlyArray<string> = [],
): Promise<Array<number>> {
	const waits: Array<number> = []

	await poll.poll_for(never_answers, {
		attempts: 10,
		interval_ms: 60_000,
		sleeper: async (duration_ms) => {
			waits.push(duration_ms)
			await no_wait()
		},
		backoff: { seen: () => seen_per_tick[waits.length] ?? 'same', schedule },
	})

	return waits.slice(0, 6)
}

// #6868: the PR completion waits — checks and CodeRabbit, then the merge.
describe('PR_POLL_SCHEDULES', () => {
	it('holds the lead through changed ticks, then starts the schedule', async () => {
		const schedule = {
			lead: { count: 2, interval_ms: 5000 },
			initial_ms: 1000,
			factor: 2,
			max_ms: 3000,
		}

		await expect(first_waits_of(schedule, ['a', 'b'])).resolves.toEqual([
			5000, 5000, 1000, 2000, 3000, 3000,
		])
	})

	it('reads the checks every 30 seconds four times, then every 20 seconds', async () => {
		await expect(first_waits_of(PR_POLL_SCHEDULES.checks)).resolves.toEqual([
			30_000, 30_000, 30_000, 30_000, 20_000, 20_000,
		])
	})

	it('reads the merge from 10 seconds, 1.5 times longer each tick, up to 30 seconds', async () => {
		await expect(first_waits_of(PR_POLL_SCHEDULES.merge)).resolves.toEqual([
			10_000, 15_000, 22_500, 30_000, 30_000, 30_000,
		])
	})
})

describe('poll.sleep', () => {
	it('resolves after the requested delay', async () => {
		const started_at = Date.now()

		await poll.sleep(INTERVAL_MS)

		expect(Date.now() - started_at).toBeGreaterThanOrEqual(0)
	})
})
