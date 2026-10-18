import path from 'node:path'
import {
	ESLINT_CACHE_FILE,
	ESLINT_CACHE_FLAGS,
	PRETTIER_CACHE_FLAGS,
} from '#scripts/josh/josh-command-types'
import { describe, expect, it } from 'vitest'
import { lint_gate_scope } from './lint-gate-scope'

// joshuafolkken/kit#4085: the gate lints the branch's changed files, and falls back to the whole tree
// wherever a cache entry would not see the change — CI, a changed configuration, an unreadable change.

// Real paths in this repository, because the narrowed scope drops a path the tree does not hold.
const ROOT = process.cwd()
const SOURCE = path.join(ROOT, 'scripts', 'lint', 'lint-gate-scope.ts')
const NOT_CI = {}
const IN_CI = { CI: 'true' }

function scope_of(relative: string): ReturnType<typeof lint_gate_scope.resolve_gate_scope> {
	return lint_gate_scope.resolve_gate_scope([SOURCE, path.join(ROOT, relative)], ROOT, NOT_CI)
}

describe('lint_gate_scope.resolve_gate_scope', () => {
	it('narrows to the changed files outside CI', () => {
		const scope = lint_gate_scope.resolve_gate_scope([SOURCE], ROOT, NOT_CI)

		expect(scope).toStrictEqual({ mode: 'related', files: [SOURCE], reason: '1 changed file(s)' })
	})

	it('lints the whole tree in CI, whatever changed', () => {
		const scope = lint_gate_scope.resolve_gate_scope([SOURCE], ROOT, IN_CI)

		expect(scope).toStrictEqual({ mode: 'all', files: [], reason: lint_gate_scope.CI_REASON })
	})

	it.each([
		'package.json',
		'pnpm-lock.yaml',
		'.npmrc',
		'.prettierignore',
		'.prettierrc.json',
		'prettier.config.js',
		'prettier/index.js',
		'eslint.config.js',
		'eslint/rules/naming-convention.js',
		'tsconfig.json',
		'tsconfig/base.json',
		'svelte.config.js',
	])('lints the whole tree when %j changed', (relative) => {
		expect(scope_of(relative)).toStrictEqual({
			mode: 'all',
			files: [],
			reason: lint_gate_scope.CONFIG_REASON,
		})
	})

	it('lints the whole tree when the change could not be read', () => {
		const scope = lint_gate_scope.resolve_gate_scope(undefined, ROOT, NOT_CI)

		expect(scope.mode).toBe('all')
	})
})

describe('lint_gate_scope.narrowed_run', () => {
	it('lints the given files on the gate’s own caches', () => {
		const narrowed = lint_gate_scope.narrowed_run([SOURCE])

		expect(narrowed.eslint).toStrictEqual(expect.arrayContaining([SOURCE, ...ESLINT_CACHE_FLAGS]))
		expect(narrowed.prettier).toStrictEqual(
			expect.arrayContaining([SOURCE, ...PRETTIER_CACHE_FLAGS]),
		)
		expect(narrowed.recheck).toMatchObject({ cache_file: ESLINT_CACHE_FILE, patterns: [SOURCE] })
	})
})
