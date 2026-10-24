import { describe, expect, it } from 'vitest'
import { test_pinned_pool } from './test-pinned-pool'

const ITEMS = ['a', 'b', 'c', 'd', 'e']
const LANE_FAILED = 'lane failed'

// Each lane answers its items upper-cased after a delay that grows with the lane's first item, so the
// lanes finish out of order and a wrong reassembly would show.
async function upper_lane(group: ReadonlyArray<string>): Promise<Array<string>> {
	const delay = ITEMS.length - ITEMS.indexOf(group[0] ?? '')

	await new Promise((resolve) => {
		setTimeout(resolve, delay)
	})

	return group.map((item) => item.toUpperCase())
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

describe('test_pinned_pool.deal', () => {
	it('deals the items round-robin and leaves no empty lane', () => {
		expect(test_pinned_pool.deal(ITEMS, 2)).toEqual([
			['a', 'c', 'e'],
			['b', 'd'],
		])
		expect(test_pinned_pool.deal(['a'], 3)).toEqual([['a']])
	})
})

describe('test_pinned_pool.run_pool', () => {
	it('answers the results in the items order whatever the lane count', async () => {
		const serial = await test_pinned_pool.run_pool(ITEMS, 1, upper_lane)

		expect(serial).toEqual(['A', 'B', 'C', 'D', 'E'])
		expect(await test_pinned_pool.run_pool(ITEMS, 2, upper_lane)).toEqual(serial)
		expect(await test_pinned_pool.run_pool(ITEMS, 4, upper_lane)).toEqual(serial)
	})

	it('rejects with a failed lane only once every other lane has ended', async () => {
		const ended: Array<string> = []

		async function failing_lane(group: ReadonlyArray<string>): Promise<Array<string>> {
			if (group[0] === 'a') throw new Error(LANE_FAILED)
			const answers = await upper_lane(group)

			ended.push(...answers)

			return answers
		}

		await expect(test_pinned_pool.run_pool(ITEMS, 2, failing_lane)).rejects.toThrow(LANE_FAILED)
		expect(ended).toEqual(['B', 'D'])
	})
})
