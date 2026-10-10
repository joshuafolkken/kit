import path from 'node:path'
import type { ESLint } from 'eslint'
import { describe, expect, it, vi } from 'vitest'

const ROOT = path.resolve('/repository')
const FILE = path.join(ROOT, 'scripts/example.ts')
const OPTIONS = { max: 300, skipBlankLines: true, skipComments: true }

const constructed: Array<ESLint.Options> = []
const limits = new Map([[FILE, OPTIONS]])
const asked_config_files: Array<string | undefined> = []
const CHECKOUT_CONFIG = path.resolve(import.meta.dirname, '..', '..', 'eslint.config.js')

// The one method the module calls, under eslint's own camelCase name.
const LINT_FILES = 'lintFiles'

vi.mock('eslint', () => ({
	ESLint: function fake_eslint(options: ESLint.Options): Record<string, () => Promise<[]>> {
		constructed.push(options)

		return { [LINT_FILES]: async (): Promise<[]> => [] }
	},
}))

// As the real one answers: nothing for no path, whatever the configuration says.
async function fake_options_for(
	file_paths: ReadonlyArray<string>,
	_root: string,
	config_file?: string,
): Promise<ReadonlyMap<string, typeof OPTIONS>> {
	asked_config_files.push(config_file)

	return file_paths.length === 0 ? new Map() : new Map(limits)
}

vi.mock('#scripts/lines/effective-limit', () => ({
	effective_limit: { options_for: fake_options_for },
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

	// joshuafolkken/kit#3644: the merge-base's own configuration is loaded with this checkout's
	// `node_modules` and stops loading once the branch drops a package it imports.
	it('asks this checkout’s eslint configuration for the limit and the count, whatever tree it measures', async () => {
		constructed.length = 0
		asked_config_files.length = 0
		await metrics_code_lines.code_line_counts([FILE], ROOT)

		expect(asked_config_files).toStrictEqual([CHECKOUT_CONFIG])
		expect(constructed.map((options) => options.overrideConfigFile)).toStrictEqual([
			CHECKOUT_CONFIG,
		])
	})

	// joshuafolkken/kit#3644: a configuration that fails to load reads as "no limit" on every file, and
	// a merge-base measured that way is a total of zero the whole codebase then grew past.
	it('refuses a tree where eslint sets max-lines on none of the files rather than totalling zero', async () => {
		limits.clear()

		const counted = metrics_code_lines.code_line_counts([FILE], ROOT)

		limits.set(FILE, OPTIONS)

		await expect(counted).rejects.toThrow(`${CHECKOUT_CONFIG} did not load`)
		await expect(counted).rejects.toThrow('pnpm josh lint')
	})

	it('totals nothing for a tree that holds no script file', async () => {
		expect(await metrics_code_lines.code_line_counts([], ROOT)).toStrictEqual(new Map())
	})
})
