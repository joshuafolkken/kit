import { describe, expect, it } from 'vitest'
import { GH_SPAWN_CONCURRENCY as EXEC_WIDTH } from './git-gh-exec'
import { GH_SPAWN_CONCURRENCY } from './git-gh-spawn-width'

describe('GH_SPAWN_CONCURRENCY — the gh spawn width', () => {
	it('is a positive whole number of slots', () => {
		expect(Number.isSafeInteger(GH_SPAWN_CONCURRENCY)).toBe(true)
		expect(GH_SPAWN_CONCURRENCY).toBeGreaterThan(0)
	})

	it('is the width the gh layer re-exports', () => {
		expect(EXEC_WIDTH).toBe(GH_SPAWN_CONCURRENCY)
	})
})
