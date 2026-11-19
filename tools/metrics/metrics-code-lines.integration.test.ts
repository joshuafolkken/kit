import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { metrics_code_lines } from './metrics-code-lines'
import { metrics_line_cache } from './metrics-line-cache'

// A real hashbang entry point verifies that CI single-run inference and local parsing agree about
// which lines count as code (joshuafolkken/kit#3408).
const HASHBANG_FILE = path.resolve('tools/metrics/metrics-command.ts')
const make_directory = temporary_directory()

async function count_with_ci(value: string): Promise<number | undefined> {
	vi.stubEnv('CI', value)

	const counts = await metrics_code_lines.code_line_counts(
		[HASHBANG_FILE],
		process.cwd(),
		metrics_line_cache.no_store,
	)

	return counts.get(HASHBANG_FILE)
}

// joshuafolkken/kit#3644: the merge-base's tree as `base-tree.ts` builds it — this checkout's
// `node_modules` behind a symlink — holding a configuration those modules cannot load.
const TREE_PREFIX = 'josh-metrics-broken-config-'
const BROKEN_CONFIG = "import 'a-package-this-branch-dropped'\n\nexport default []\n"
const SCRIPT_FILE = path.join('scripts', 'example.ts')
const SOURCE = ['// a comment', '', 'const a = 1', 'const b = 2', ''].join('\n')
const SOURCE_CODE_LINES = 2
const COUNT_TIMEOUT_MS = 120_000

// Resolved, because eslint reports a file by its real path and macOS keeps its temp directory behind
// a symlink.
function broken_tree(): string {
	const made = make_directory(TREE_PREFIX)
	const tree = realpathSync(made)

	mkdirSync(path.join(tree, path.dirname(SCRIPT_FILE)))
	writeFileSync(path.join(tree, 'eslint.config.js'), BROKEN_CONFIG)
	writeFileSync(path.join(tree, SCRIPT_FILE), SOURCE)
	symlinkSync(path.resolve('node_modules'), path.join(tree, 'node_modules'), 'dir')

	return tree
}

describe('metrics_code_lines.code_line_counts on a tree whose own configuration cannot load', () => {
	it(
		'counts it under this checkout’s configuration instead of refusing the tree',
		async () => {
			const tree = broken_tree()
			const file = path.join(tree, SCRIPT_FILE)
			const counts = await metrics_code_lines.code_line_counts(
				[file],
				tree,
				metrics_line_cache.no_store,
			)

			expect([...counts]).toStrictEqual([[file, SOURCE_CODE_LINES]])
		},
		COUNT_TIMEOUT_MS,
	)
})

// joshuafolkken/kit#8205: a stored count stands in for eslint's, so it has to be eslint's answer.
const STORED_FILES = [HASHBANG_FILE, path.resolve('tools/metrics/metrics-base-cache.ts')]

describe('metrics_code_lines.code_line_counts with stored counts', () => {
	it(
		'answers the same counts from a cold store, a warm store and no store',
		async () => {
			const store = metrics_line_cache.file_store(
				path.join(make_directory('josh-metrics-line-store-'), 'record.json'),
			)
			const fresh = await metrics_code_lines.code_line_counts(
				STORED_FILES,
				process.cwd(),
				metrics_line_cache.no_store,
			)
			const cold = await metrics_code_lines.code_line_counts(STORED_FILES, process.cwd(), store)
			const warm = await metrics_code_lines.code_line_counts(STORED_FILES, process.cwd(), store)

			expect(fresh.size).toBe(STORED_FILES.length)
			expect([...cold]).toStrictEqual([...fresh])
			expect([...warm]).toStrictEqual([...fresh])
			expect(store.load().size).toBe(STORED_FILES.length)
		},
		COUNT_TIMEOUT_MS,
	)
})

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
