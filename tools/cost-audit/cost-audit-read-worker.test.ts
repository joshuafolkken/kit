import { isMainThread } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { cost_audit_read } from './cost-audit-read'

// joshuafolkken/kit#8757: the read worker reads only inside a worker thread; its reading in one is
// driven through `cost-audit-read-pool.test.ts`.

describe('cost-audit-read-worker — outside a worker thread', () => {
	it('reads nothing when loaded on the main thread', async () => {
		const read_files = vi.spyOn(cost_audit_read, 'read_files')

		await import('./cost-audit-read-worker')

		expect(isMainThread).toBe(true)
		expect(read_files).not.toHaveBeenCalled()
	})
})
