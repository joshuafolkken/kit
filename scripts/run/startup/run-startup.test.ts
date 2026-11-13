import { gh_request_tally } from '#scripts/gh/gh-request-tally'
import { shared_cache } from '#scripts/josh/shared-cache'
import { shared_cache_fixture } from '#scripts/josh/shared-cache-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { run_startup } from './run-startup'
import type { StartupEntry } from './run-startup-schema'
import { run_startup_store } from './run-startup-store'

const SCOPE = { run: 'run-fixture', attempt: 'attempt-fixture', issue: '7422' }
const SLOT = { prefix: 'startup-test-', ttl_ms: 1000 }
const RESOURCE_WAIT = 'resource wait'
const rows: Array<StartupEntry> = []

beforeEach(() => {
	rows.length = 0
	vi.spyOn(run_startup_store, 'record').mockImplementation(async (row) => {
		rows.push(row)
	})
	shared_cache_fixture.keep_in_memory()
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.useRealTimers()
})

async function measured<T>(run: () => Promise<T>): Promise<T> {
	return await run_startup.within(SCOPE, async () => await run_startup.phase('launch', run))
}

describe('run_startup.phase', () => {
	it('persists fractional epoch timestamps for starts, metrics and endings', async () => {
		const instant = 0.2

		vi.spyOn(performance, 'now').mockReturnValue(instant)
		await measured(async () => run_startup.metric('cache', 'fill', 'same'))
		expect(rows.map((row) => row.edge)).toEqual(['start', 'cache', 'done'])
		expect(rows.every((row) => row.at_ms === performance.timeOrigin + instant)).toBe(true)
	})

	it('keeps nested spans and propagated identities on parallel issues', async () => {
		await measured(
			async () =>
				await Promise.all(
					['first', 'second'].map(
						async (issue) =>
							await run_startup.phase(
								'worker',
								async () => {
									await Promise.resolve()

									return run_startup.environment()
								},
								{ issue },
							),
					),
				),
		)
		const starts = rows.filter((row) => row.edge === 'start')

		expect(starts.map((row) => row.issue)).toEqual(['7422', 'first', 'second'])
		expect(new Set(starts.map((row) => row.id)).size).toBe(starts.length)
		expect(starts.slice(1).every((row) => row.parent === starts[0]?.id)).toBe(true)
		expect(rows.every((row) => row.run === SCOPE.run && row.attempt === SCOPE.attempt)).toBe(true)
	})
})

describe('run_startup failure accounting', () => {
	it('records thrown and returned failures without turning them into success', async () => {
		const failure = new Error('launch failed')

		await expect(
			measured(async () => {
				throw failure
			}),
		).rejects.toBe(failure)
		await run_startup.within(
			SCOPE,
			async () =>
				await run_startup.phase('refused', async () => false, { edge_of: () => 'failed' }),
		)
		expect(rows.filter((row) => row.edge === 'failed')).toHaveLength(2)
		expect(rows.filter((row) => row.edge === 'done')).toEqual([])
	})

	it('leaves work results and errors intact when telemetry storage fails', async () => {
		vi.mocked(run_startup_store.record).mockRejectedValue(new Error('unwritable'))
		await expect(measured(async () => 'launched')).resolves.toBe('launched')
		await expect(
			measured(async () => {
				throw new Error('original')
			}),
		).rejects.toThrow('original')
	})
})

describe('run_startup resource waiting', () => {
	it('records resource waiting separately from execution', async () => {
		await measured(async () => {
			const admitted = await run_startup.waiting(RESOURCE_WAIT)

			await admitted()

			return await run_startup.phase('install', async () => true)
		})
		expect(rows.find((row) => row.edge === 'waiting')).toMatchObject({
			phase: RESOURCE_WAIT,
			elapsed_ms: expect.any(Number),
		})
		expect(rows.find((row) => row.phase === 'install' && row.edge === 'done')).toBeDefined()
	})
})

describe('startup request and cache accounting', () => {
	it('attributes REST and GraphQL spawns and cache hits to the current phase', async () => {
		await measured(async () => {
			gh_request_tally.count_call('GET repos/{o}/{r}/issues')
			gh_request_tally.count_call('graphql')
			await shared_cache.remember(
				{ slot: SLOT, key: 'key', schema: z.string() },
				async () => 'kept',
			)

			return await shared_cache.remember(
				{ slot: SLOT, key: 'key', schema: z.string() },
				async () => 'wrong',
			)
		})
		expect(rows.filter((row) => row.edge === 'api').map((row) => row.metric)).toEqual([
			'rest',
			'graphql',
		])
		expect(rows.filter((row) => row.edge === 'cache').map((row) => row.metric)).toEqual([
			'miss',
			'fill',
			'hit',
		])
		expect(rows.every((row) => row.key !== 'key')).toBe(true)
	})
})

describe('startup concurrent cache misses', () => {
	it('observes concurrent misses without coalescing computations', async () => {
		let clock = 0

		vi.spyOn(performance, 'now').mockImplementation(() => {
			const instant = clock

			clock += 1

			return instant
		})
		const compute = vi.fn(async () => {
			await Promise.resolve()

			return 'value'
		})

		await measured(
			async () =>
				await Promise.all(
					['first', 'second'].map(
						async (issue) =>
							await run_startup.phase(
								'request',
								async () =>
									await shared_cache.remember(
										{ slot: SLOT, key: 'same', schema: z.string() },
										compute,
									),
								{ issue },
							),
					),
				),
		)
		expect(compute).toHaveBeenCalledTimes(2)
		expect(run_startup_store.concurrent_misses(rows).length).toBeGreaterThan(0)
	})
})

it('records an undefined cache computation as failed without caching it', async () => {
	const compute = vi.fn(async () => undefined)

	await measured(async () => {
		await shared_cache.remember({ slot: SLOT, key: 'missing', schema: z.string() }, compute)
		await shared_cache.remember({ slot: SLOT, key: 'missing', schema: z.string() }, compute)
	})
	expect(compute).toHaveBeenCalledTimes(2)
	expect(rows.filter((row) => row.edge === 'failed').map((row) => row.phase)).toEqual([
		`cache fill ${SLOT.prefix}`,
		`cache fill ${SLOT.prefix}`,
	])
})
