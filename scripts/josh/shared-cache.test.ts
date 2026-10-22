import { randomUUID } from 'node:crypto'
import { git_common_directory } from '#scripts/git/git-common-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { shared_cache, type CacheSlot } from './shared-cache'
import { shared_cache_fixture } from './shared-cache-fixture'
import { stamp_file } from './stamp-file'

const SLOT: CacheSlot = { prefix: 'josh-shared-cache-test-', ttl_ms: 60_000 }
const NOW_MS = Date.parse('2026-10-22T12:00:00Z')
const KEY = 'owner/repo'
const VALUE = { count: 3 }
const value_schema = z.object({ count: z.number() })
const HALF_TTL_MS = 30_000

// Each test keys the record to a root of its own, the way two repositories never share one.
beforeEach(() => shared_cache_fixture.isolate_shared_cache(SLOT))

afterEach(() => {
	shared_cache.clear(SLOT)
	vi.restoreAllMocks()
})

async function remember_count(now_ms: number, key: string = KEY): Promise<number> {
	const compute = vi.fn(async () => VALUE)

	await shared_cache.remember({ slot: SLOT, key, schema: value_schema }, compute, now_ms)

	return compute.mock.calls.length
}

describe('shared_cache.remember', () => {
	it('computes once and answers a second ask within the TTL from the record', async () => {
		expect(await remember_count(NOW_MS)).toBe(1)
		expect(await remember_count(NOW_MS + HALF_TTL_MS)).toBe(0)
	})

	it('computes again once the TTL has passed', async () => {
		await remember_count(NOW_MS)

		expect(await remember_count(NOW_MS + SLOT.ttl_ms)).toBe(1)
	})

	it('computes again for another key, which replaces the record', async () => {
		await remember_count(NOW_MS)

		expect(await remember_count(NOW_MS, 'other/repo')).toBe(1)
		expect(await remember_count(NOW_MS)).toBe(1)
	})

	it('keeps no undefined answer', async () => {
		const request = { slot: SLOT, key: KEY, schema: value_schema }

		await shared_cache.remember(
			request,
			async () => {
				await Promise.resolve(undefined)
			},
			NOW_MS,
		)

		expect(shared_cache.read(SLOT, KEY, value_schema, NOW_MS)).toBeUndefined()
	})

	// The record sits at the repository's common root, never the work tree's own `PROJECT_ROOT`.
	it('shares the record between two work trees of one repository', async () => {
		const common = `/shared-cache-test/${randomUUID()}`

		vi.mocked(git_common_directory.repository).mockReturnValue(common)
		await remember_count(NOW_MS)

		expect(stamp_file.read_stamp_text(stamp_file.stamp_path(SLOT.prefix, common))).toContain(KEY)
	})
})
