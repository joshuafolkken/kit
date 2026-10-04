import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { josh_harness } from './josh-harness'

// The scenarios that open an environment live in the `josh-harness-*.test.ts` files beside this one,
// one per set of environments, so they run in parallel (joshuafolkken/kit#3083).

const SETUP_FAILED = 'setup failed'

describe('josh harness — a setup that fails', () => {
	it('removes its workspace and rethrows the error', async () => {
		const seen: Array<string> = []
		const failing = josh_harness.in_workspace((workspace) => {
			seen.push(workspace)
			throw new Error(SETUP_FAILED)
		})

		await expect(failing).rejects.toThrow(SETUP_FAILED)
		expect(seen).toHaveLength(1)
		expect(existsSync(seen[0] ?? '')).toBe(false)
	})
})
