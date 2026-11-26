import { describe, expect, it } from 'vitest'
import { test_pinned_pool } from './test-pinned-pool'

const ITEMS = ['a', 'b', 'c', 'd', 'e']
const LANE_FAILED = 'lane failed'
const SLOW_MS = 40
const FAST_MS = 1

async function pause(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

// Each item is answered upper-cased after a delay that shrinks along the items, so the lanes finish
// out of order and a wrong reassembly would show.
async function upper_lane(queue: Iterable<string>): Promise<Array<string>> {
	const answers: Array<string> = []

	for (const item of queue) {
		// eslint-disable-next-line no-await-in-loop -- a lane answers its items one at a time
		await pause(ITEMS.length - ITEMS.indexOf(item))
		answers.push(item.toUpperCase())
	}

	return answers
}

// A lane that records what it took, item `a` slow and the rest fast.
function taking_lane(
	taken: Array<Array<string>>,
): (queue: Iterable<string>) => Promise<Array<string>> {
	return async function lane(queue: Iterable<string>): Promise<Array<string>> {
		const mine: Array<string> = []

		taken.push(mine)

		for (const item of queue) {
			mine.push(item)
			// eslint-disable-next-line no-await-in-loop -- a lane answers its items one at a time
			await pause(item === 'a' ? SLOW_MS : FAST_MS)
		}

		return mine.map((item) => item.toUpperCase())
	}
}

// Item `e` costs the most.
function last_costliest(item: string): number {
	return item === 'e' ? 1 : 0
}

// A lane halted after its first item: it takes a second one and never answers it.
async function halted_lane(queue: Iterable<string>): Promise<Array<string>> {
	const [first, second] = queue

	return first === undefined || second === undefined ? [] : [first.toUpperCase()]
}

describe('test_pinned_pool.lane_plan', () => {
	it('opens one lane per worker up to the hunk count and the tree cap', () => {
		expect(test_pinned_pool.lane_plan(2, 8)).toEqual({ lanes: 2, workers: 4 })
		expect(test_pinned_pool.lane_plan(20, 8)).toEqual({
			lanes: test_pinned_pool.MAX_TREES,
			workers: 2,
		})
		expect(test_pinned_pool.lane_plan(20, 3)).toEqual({ lanes: 3, workers: 1 })
	})

	it('runs a single lane when the budget is one worker or unread', () => {
		expect(test_pinned_pool.lane_plan(5, 1)).toEqual({ lanes: 1, workers: 1 })
		expect(test_pinned_pool.lane_plan(5)).toEqual({ lanes: 1, workers: 1 })
	})
})

describe('test_pinned_pool.queue_order', () => {
	it('queues the costliest item first and keeps equal costs in order', () => {
		const costs = [1, 5, 1, 9, 5]

		expect(test_pinned_pool.queue_order(costs, (cost) => cost)).toEqual([3, 1, 4, 0, 2])
	})

	it('keeps the items order without a cost', () => {
		expect(test_pinned_pool.queue_order(ITEMS)).toEqual([0, 1, 2, 3, 4])
	})
})

describe('test_pinned_pool.run_pool', () => {
	it('answers the results in the items order whatever the lane count', async () => {
		const serial = await test_pinned_pool.run_pool(ITEMS, 1, upper_lane)

		expect(serial).toEqual(['A', 'B', 'C', 'D', 'E'])
		expect(await test_pinned_pool.run_pool(ITEMS, 2, upper_lane)).toEqual(serial)
		expect(await test_pinned_pool.run_pool(ITEMS, 4, upper_lane)).toEqual(serial)
	})

	it('lets a free lane take the next item while another lane is busy', async () => {
		const taken: Array<Array<string>> = []
		const answers = await test_pinned_pool.run_pool(ITEMS, 2, taking_lane(taken))

		expect(answers).toEqual(['A', 'B', 'C', 'D', 'E'])
		expect(taken).toEqual([['a'], ['b', 'c', 'd', 'e']])
	})

	it('hands the costliest item out first and still answers in the items order', async () => {
		const taken: Array<Array<string>> = []
		const answers = await test_pinned_pool.run_pool(ITEMS, 1, taking_lane(taken), last_costliest)

		expect(taken).toEqual([['e', 'a', 'b', 'c', 'd']])
		expect(answers).toEqual(['A', 'B', 'C', 'D', 'E'])
	})

	it('never runs more lanes than it was given', async () => {
		let running = 0
		let most = 0

		async function counted(queue: Iterable<string>): Promise<Array<string>> {
			running += 1
			most = Math.max(most, running)
			const answers = await upper_lane(queue)

			running -= 1

			return answers
		}

		await test_pinned_pool.run_pool(ITEMS, 2, counted)
		expect(most).toBe(2)
	})
})

describe('test_pinned_pool.run_pool stops', () => {
	it('leaves out an item a lane took but stopped before answering', async () => {
		expect(await test_pinned_pool.run_pool(ITEMS, 1, halted_lane)).toEqual(['A'])
	})

	it('rejects with a failed lane only once every other lane has ended', async () => {
		const ended: Array<string> = []

		async function failing_lane(queue: Iterable<string>): Promise<Array<string>> {
			const answers: Array<string> = []

			for (const item of queue) {
				if (item === 'a') throw new Error(LANE_FAILED)
				// eslint-disable-next-line no-await-in-loop -- a lane answers its items one at a time
				await pause(FAST_MS)
				answers.push(item.toUpperCase())
			}

			ended.push(...answers)

			return answers
		}

		await expect(test_pinned_pool.run_pool(ITEMS, 2, failing_lane)).rejects.toThrow(LANE_FAILED)
		expect(ended).toEqual(['B', 'C', 'D', 'E'])
	})
})
