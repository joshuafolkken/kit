import path from 'node:path'
import type { ESLint } from 'eslint'
import { describe, expect, it, vi } from 'vitest'

const ROOT = path.resolve('/repository')
const FILE = path.join(ROOT, 'scripts/example.ts')
const OPTIONS = { max: 300, skipBlankLines: true, skipComments: true }

const constructed: Array<ESLint.Options> = []
const limits = new Map([[FILE, OPTIONS]])

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
		options_for: async (): Promise<ReadonlyMap<string, typeof OPTIONS>> => new Map(limits),
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

	// joshuafolkken/kit#3644: a configuration that fails to load reads as "no limit" on every file, and
	// a merge-base measured that way is a total of zero the whole codebase then grew past.
	it('refuses a tree where eslint sets max-lines on none of the files rather than totalling zero', async () => {
		limits.clear()

		const counted = metrics_code_lines.code_line_counts([FILE], ROOT)

		limits.set(FILE, OPTIONS)

		await expect(counted).rejects.toThrow('its eslint configuration did not load there')
	})

	it('totals nothing for a tree that holds no script file', async () => {
		expect(await metrics_code_lines.code_line_counts([], ROOT)).toStrictEqual(new Map())
	})
})
