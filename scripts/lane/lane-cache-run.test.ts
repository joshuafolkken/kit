import { lane_registry } from '#scripts/lane/lane-registry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { lane_cache } from './lane-cache'
import { lane_cache_run } from './lane-cache-run'

const MAIN_ROOT = '/repository/main'
const LANE_ROOT = '/repository/.kit-lanes/2060'
const CACHE_FILE = '.eslintcache'
const RESULT = 42

const sync_cache = vi.spyOn(lane_cache, 'sync_cache')
const main_repository_root = vi.spyOn(lane_registry, 'main_repository_root')

beforeEach(() => {
	vi.clearAllMocks()
	main_repository_root.mockResolvedValue(MAIN_ROOT)
})

async function successful_work(): Promise<number> {
	return RESULT
}

describe('lane_cache_run.run without a repository root', () => {
	it('runs the tool without cache sharing when the main root cannot be resolved', async () => {
		const work = vi.fn(successful_work)

		main_repository_root.mockRejectedValueOnce(new Error('not a git worktree'))

		await expect(lane_cache_run.run(CACHE_FILE, work, LANE_ROOT)).resolves.toBe(RESULT)
		expect(work).toHaveBeenCalledOnce()
		expect(sync_cache).not.toHaveBeenCalled()
	})
})

describe('lane_cache_run.run', () => {
	it('refreshes before the tool and publishes immediately afterwards', async () => {
		const work = vi.fn(async function observed_work(): Promise<number> {
			expect(sync_cache).toHaveBeenLastCalledWith(MAIN_ROOT, LANE_ROOT, CACHE_FILE)

			return RESULT
		})

		await expect(lane_cache_run.run(CACHE_FILE, work, LANE_ROOT)).resolves.toBe(RESULT)
		expect(sync_cache.mock.calls).toEqual([
			[MAIN_ROOT, LANE_ROOT, CACHE_FILE],
			[LANE_ROOT, MAIN_ROOT, CACHE_FILE],
		])
	})

	it('publishes a completed cache when the tool throws', async () => {
		const failure = new Error('tool failed')

		await expect(
			lane_cache_run.run(
				CACHE_FILE,
				async function fail_tool(): Promise<never> {
					throw failure
				},
				LANE_ROOT,
			),
		).rejects.toBe(failure)
		expect(sync_cache).toHaveBeenLastCalledWith(LANE_ROOT, MAIN_ROOT, CACHE_FILE)
	})

	it('refreshes and publishes again on every invocation', async () => {
		await lane_cache_run.run(CACHE_FILE, successful_work, LANE_ROOT)
		await lane_cache_run.run(CACHE_FILE, successful_work, LANE_ROOT)

		expect(sync_cache).toHaveBeenCalledTimes(4)
	})
})

describe('lane_cache_run.run in the main checkout', () => {
	it('does no cache I/O in the main checkout', async () => {
		await expect(
			lane_cache_run.run(
				CACHE_FILE,
				async function main_work(): Promise<number> {
					return RESULT
				},
				MAIN_ROOT,
			),
		).resolves.toBe(RESULT)
		expect(sync_cache).not.toHaveBeenCalled()
	})
})
