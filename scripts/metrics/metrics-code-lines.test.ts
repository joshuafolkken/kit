import path from 'node:path'
import type { ESLint } from 'eslint'
import { describe, expect, it, vi } from 'vitest'

const ROOT = path.resolve('/repository')
const FILE = path.join(ROOT, 'scripts/example.ts')
const OPTIONS = { max: 300, skipBlankLines: true, skipComments: true }

const constructed: Array<ESLint.Options> = []

// The one method the module calls, under eslint's own camelCase name.
const LINT_FILES = 'lintFiles'

vi.mock('eslint', () => ({
	ESLint: function fake_eslint(options: ESLint.Options): Record<string, () => Promise<[]>> {
		constructed.push(options)

		return { [LINT_FILES]: async (): Promise<[]> => [] }
	},
}))

vi.mock('#scripts/lines/effective-limit', () => ({
	effective_limit: {
		options_for: async (): Promise<ReadonlyMap<string, typeof OPTIONS>> =>
			new Map([[FILE, OPTIONS]]),
	},
}))

const { metrics_code_lines } = await import('./metrics-code-lines')

// joshuafolkken/kit#1332: eslint deletes `cacheLocation` whenever `cache` is off, and the default is
// the `.eslintcache` the gate's concurrent lint step relies on.
describe('metrics_code_lines.code_line_counts', () => {
	it('points eslint’s cache location outside the checkout so the gate’s lint cache survives', async () => {
		constructed.length = 0
		await metrics_code_lines.code_line_counts([FILE], ROOT)

		expect(constructed).toHaveLength(1)
		const location = constructed[0]?.cacheLocation ?? path.join(ROOT, '.eslintcache')

		expect(path.relative(ROOT, location).startsWith('..')).toBe(true)
	})
})
