import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { line_budget } from '#scripts/lines/line-budget'
import { temporary_directory } from '#tools/test/temporary-directory'
import type { ESLint } from 'eslint'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LineStore } from './metrics-line-cache'

const ROOT = path.resolve('/repository')
const FILE = path.join(ROOT, 'scripts/example.ts')
const OPTIONS = { max: 300, skipBlankLines: true, skipComments: true }

const constructed: Array<ESLint.Options> = []
const limits = new Map([[FILE, OPTIONS]])
const asked_config_files: Array<string | undefined> = []
const linted: Array<string> = []
const CHECKOUT_CONFIG = path.resolve(import.meta.dirname, '..', '..', 'eslint.config.js')

// The one method the module calls, under eslint's own camelCase name.
const LINT_FILES = 'lintFiles'

interface FakeResult {
	filePath: string
	messages: []
}

vi.mock('eslint', () => ({
	ESLint: function fake_eslint(
		options: ESLint.Options,
	): Record<string, (paths: Array<string>) => Promise<Array<FakeResult>>> {
		constructed.push(options)

		return {
			[LINT_FILES]: async (paths): Promise<Array<FakeResult>> => {
				linted.push(...paths)

				return await paths.map((file) => ({ filePath: file, messages: [] }))
			},
		}
	},
}))

// As the real one answers: nothing for no path, whatever the configuration says.
async function fake_options_for(
	file_paths: ReadonlyArray<string>,
	_root: string,
	config_file?: string,
): Promise<ReadonlyMap<string, typeof OPTIONS>> {
	asked_config_files.push(config_file)

	return file_paths.length === 0 || limits.size === 0
		? new Map()
		: new Map(file_paths.map((file) => [file, OPTIONS]))
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

const COUNTED_LINES = 7
const make_directory = temporary_directory()

function memory_store(): LineStore {
	const entries = new Map<string, number>()

	return {
		load: (): ReadonlyMap<string, number> => new Map(entries),
		save: (fresh): void => {
			for (const [key, count] of fresh) entries.set(key, count)
		},
	}
}

const DIRECTORY_PREFIX = 'josh-metrics-lines-'
const FIRST_TEXT = 'const a = 1\n'

// Every file eslint linted reads as `COUNTED_LINES` code lines.
function count_every_linted_file(): void {
	linted.length = 0
	vi.spyOn(line_budget, 'counts_from').mockImplementation(
		(results) => new Map(results.map((result) => [result.filePath, COUNTED_LINES])),
	)
}

// joshuafolkken/kit#8205: a file whose text is unchanged since a run counted it is not counted again.
describe('metrics_code_lines.code_line_counts with a store', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('counts a file once and answers the stored count after', async () => {
		const file = path.join(make_directory(DIRECTORY_PREFIX), 'example.ts')

		writeFileSync(file, FIRST_TEXT)
		const store = memory_store()

		count_every_linted_file()
		const first = await metrics_code_lines.code_line_counts([file], ROOT, store)
		const second = await metrics_code_lines.code_line_counts([file], ROOT, store)

		expect(linted).toStrictEqual([file])
		expect([...first]).toStrictEqual([[file, COUNTED_LINES]])
		expect([...second]).toStrictEqual([...first])
	})

	it('counts again only the file whose text changed', async () => {
		const directory = make_directory(DIRECTORY_PREFIX)
		const [kept, edited] = [path.join(directory, 'kept.ts'), path.join(directory, 'edited.ts')]

		writeFileSync(kept, FIRST_TEXT)
		writeFileSync(edited, FIRST_TEXT.replace('a', 'b'))
		const store = memory_store()

		count_every_linted_file()
		await metrics_code_lines.code_line_counts([kept, edited], ROOT, store)
		writeFileSync(edited, 'const b = 2\n')
		await metrics_code_lines.code_line_counts([kept, edited], ROOT, store)

		expect(linted).toStrictEqual([kept, edited, edited])
	})
})

describe('metrics_code_lines.code_line_counts on a file eslint reported no count on', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('leaves the file out and stores nothing for it', async () => {
		const file = path.join(make_directory(DIRECTORY_PREFIX), 'uncounted.ts')

		writeFileSync(file, FIRST_TEXT)
		const store = memory_store()

		vi.spyOn(line_budget, 'counts_from').mockImplementation(() => new Map())

		expect(await metrics_code_lines.code_line_counts([file], ROOT, store)).toStrictEqual(new Map())
		expect(store.load().size).toBe(0)
	})
})
