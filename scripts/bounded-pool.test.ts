import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bounded_pool } from './bounded-pool'

// Timers rather than hand-rolled gates: a task's duration is what decides when its slot is freed, so
// a fake clock lets "how many ran at once" and "when did the third start" be assertions instead of
// races.
const SLOW_MS = 30
const QUICK_MS = 10
const BRIEF_MS = 5
const LIMIT = 2
const WORKER_FAILED = 'worker failed'

async function sleep(duration_ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, duration_ms)
	})
}

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
})

describe('bounded_pool.pool_width', () => {
	it('never starts more consumers than there is work', () => {
		expect(bounded_pool.pool_width(8, 3)).toBe(3)
	})

	// A limit below one would start no consumer at all and return an empty result for a non-empty
	// input, which reads as "nothing to do" rather than as the misconfiguration it is.
	it('starts one consumer when the limit is below one, rather than none', () => {
		expect(bounded_pool.pool_width(0, 3)).toBe(1)
	})

	it('uses the limit when there is more work than the limit', () => {
		expect(bounded_pool.pool_width(LIMIT, 5)).toBe(LIMIT)
	})
})

describe('bounded_pool.bounded_map', () => {
	it('never runs more than the limit at once', async () => {
		let in_flight = 0
		let peak = 0
		const durations = [QUICK_MS, QUICK_MS, QUICK_MS, QUICK_MS, QUICK_MS]
		const run = bounded_pool.bounded_map(durations, LIMIT, async (duration) => {
			in_flight += 1
			peak = Math.max(peak, in_flight)
			await sleep(duration)
			in_flight -= 1

			return duration
		})

		await vi.advanceTimersByTimeAsync(SLOW_MS * LIMIT)
		await run

		expect(peak).toBe(LIMIT)
	})

	// A wave implementation idles the whole batch behind its slowest member: with these durations it
	// would start the third task at 30ms rather than at 10ms, when the second one's slot came free.
	it('refills a slot as soon as one task ends, rather than waiting for the wave', async () => {
		const started: Array<number> = []
		const durations = [SLOW_MS, QUICK_MS, BRIEF_MS]
		const run = bounded_pool.bounded_map(durations, LIMIT, async (duration, index) => {
			started.push(index)
			await sleep(duration)

			return index
		})

		await vi.advanceTimersByTimeAsync(QUICK_MS)

		expect(started).toStrictEqual([0, 1, 2])

		await vi.advanceTimersByTimeAsync(SLOW_MS)
		await run
	})
})

describe('bounded_pool.bounded_map results', () => {
	it('returns results in input order however they finished', async () => {
		const run = bounded_pool.bounded_map([SLOW_MS, BRIEF_MS], LIMIT, async (duration) => {
			await sleep(duration)

			return duration
		})

		await vi.advanceTimersByTimeAsync(SLOW_MS)

		expect(await run).toStrictEqual([SLOW_MS, BRIEF_MS])
	})

	it('passes each item its own index', async () => {
		const run = bounded_pool.bounded_map(
			['a', 'b'],
			1,
			async (item, index) => `${item}${String(index)}`,
		)

		await expect(run).resolves.toStrictEqual(['a0', 'b1'])
	})

	it('returns nothing for an empty input rather than hanging', async () => {
		const run = bounded_pool.bounded_map([], LIMIT, async (item: never) => item)

		await expect(run).resolves.toStrictEqual([])
	})
})

describe('bounded_pool.bounded_map failures', () => {
	// The serial loop this replaces stopped at the first throw. A pool that kept draining would spawn
	// real Claude sessions after the run had already failed.
	it('hands out no further work after a worker throws', async () => {
		const started: Array<number> = []
		const run = bounded_pool.bounded_map([0, 1, 2, 3, 4, 5], 1, async (index) => {
			started.push(index)
			await sleep(BRIEF_MS)

			if (index === 1) throw new Error(WORKER_FAILED)

			return index
		})
		const settled = expect(run).rejects.toThrow(WORKER_FAILED)

		await vi.advanceTimersByTimeAsync(SLOW_MS)
		await settled

		expect(started).toStrictEqual([0, 1])
	})

	// `Promise.all` would reject while the sibling was still mid-task, which in the eval suite ends the
	// process before that task's own cleanup runs.
	it('holds the throw until the tasks already in flight have finished', async () => {
		const finished: Array<number> = []
		const run = bounded_pool.bounded_map([BRIEF_MS, SLOW_MS], LIMIT, async (duration, index) => {
			await sleep(duration)
			finished.push(index)

			if (index === 0) throw new Error(WORKER_FAILED)

			return index
		})
		const settled = expect(run).rejects.toThrow(WORKER_FAILED)

		await vi.advanceTimersByTimeAsync(SLOW_MS)
		await settled

		expect(finished).toStrictEqual([0, 1])
	})
})

describe('bounded_pool.pool_width guards', () => {
	// `Math.max` does not close this: every comparison with NaN is false, so the clamp passes it
	// through and `Array.from({ length: NaN })` builds no consumer at all.
	it('falls back to one consumer for a width that is not a number', () => {
		expect(bounded_pool.pool_width(NaN, 3)).toBe(1)
	})

	it('falls back to one consumer for an infinite width', () => {
		expect(bounded_pool.pool_width(Infinity, 3)).toBe(1)
	})

	it('floors a fractional width rather than letting Array.from truncate it', () => {
		expect(bounded_pool.pool_width(2.9, 5)).toBe(LIMIT)
	})

	it('still runs every item when the width is not a number', async () => {
		const run = bounded_pool.bounded_map([BRIEF_MS, BRIEF_MS], NaN, async (duration) => {
			await sleep(duration)

			return duration
		})

		await vi.advanceTimersByTimeAsync(SLOW_MS)

		await expect(run).resolves.toStrictEqual([BRIEF_MS, BRIEF_MS])
	})
})
