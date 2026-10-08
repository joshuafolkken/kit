import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { metrics_code_lines } from './metrics-code-lines'

// A real entry point that starts with `#!`: typescript-eslint's single-run inference under `CI=true`
// used to count its hashbang as code there and as a comment locally (joshuafolkken/kit#3408).
const HASHBANG_FILE = path.resolve('scripts/metrics/metrics-command.ts')

async function count_with_ci(value: string): Promise<number | undefined> {
	vi.stubEnv('CI', value)

	const counts = await metrics_code_lines.code_line_counts([HASHBANG_FILE], process.cwd())

	return counts.get(HASHBANG_FILE)
}

describe('metrics_code_lines.code_line_counts on a hashbang file', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('counts the same code lines in CI as on a local run', async () => {
		const local = await count_with_ci('false')
		const ci = await count_with_ci('true')

		expect(local).toBeDefined()
		expect(ci).toBe(local)
	})
})
