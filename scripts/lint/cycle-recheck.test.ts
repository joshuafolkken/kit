import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { create_base_config } from '#eslint/base.js'
import type { BufferedProcessResult } from '#scripts/lib/buffered-process'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cycle_recheck, NO_CYCLE_RULE, type CycleRecheckOptions } from './cycle-recheck'

// joshuafolkken/kit#3641. Every case lints a real cycle on disk against a real cache file, because
// the defect is the cache file's: a verdict keyed on one file's content, about a fact that lives in
// another file. A mocked linter would have no stale entry to answer with.
const LINT_PROBE_TIMEOUT_MS = 60_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

// Clean under every other rule of the base config, so the cycle is the only thing a run can report
// and a withdrawn report leaves a green one.
const CYCLIC_A = "import { BETA } from './b'\n\nexport const ALPHA = BETA + 1\n"
const ACYCLIC_A = 'export const ALPHA = 1\n'
const EDITED_SIDE = 'a.ts'
const UNTOUCHED_SIDE = 'b.ts'
const FIXTURE_FILES: Array<[string, string]> = [
	['package.json', JSON.stringify({ type: 'module' })],
	['tsconfig.json', JSON.stringify({ compilerOptions: { module: 'nodenext' } })],
	[EDITED_SIDE, CYCLIC_A],
	[UNTOUCHED_SIDE, "import { ALPHA } from './a'\n\nexport const BETA = ALPHA + 1\n"],
]

// `realpathSync`: macOS hands back `/var/…`, a symlink to `/private/var/…`, and the resolver
// answers with the real path — the two have to agree for a cycle to close.
const created_root = mkdtempSync(path.join(tmpdir(), 'kit-cycle-recheck-'))
const root = realpathSync(created_root)
const cache_file = path.join(root, '.eslintcache')

for (const [name, source] of FIXTURE_FILES) {
	writeFileSync(path.join(root, name), source)
}

// `no-cycle` reads the import graph, not types, so the typed parser is switched off rather than
// handed a tsconfig project to build for three-line files.
const options: CycleRecheckOptions = {
	cache_file,
	patterns: ['.'],
	eslint_options: {
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: [
			...create_base_config({
				gitignore_path: new URL('../../.gitignore', import.meta.url),
				tsconfig_root_dir: root,
			}),
			ts.configs.disableTypeChecked,
		],
	},
}

// What the cached whole-tree run hands over: a failed report that names the rule.
const CACHED_RED: BufferedProcessResult = { output: NO_CYCLE_RULE, exit_code: 1, elapsed_ms: 0 }

// The whole-tree lint as it runs: the same cache file, the same content strategy.
async function cached_cycle_files(): Promise<Array<string>> {
	const linter = new ESLint({
		...options.eslint_options,
		cache: true,
		cacheStrategy: 'content',
		cacheLocation: cache_file,
	})
	const results = await linter.lintFiles(['.'])

	return results
		.filter((result) => result.messages.some((message) => message.ruleId === NO_CYCLE_RULE))
		.map((result) => path.basename(result.filePath))
}

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('cycle_recheck.verify — a cycle that is there', () => {
	it('reports it when no cache file exists yet', async () => {
		const verified = await cycle_recheck.verify(CACHED_RED, options)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(NO_CYCLE_RULE)
		expect(existsSync(cache_file)).toBe(true)
	})

	it('reports it again from the cache file the first run wrote', async () => {
		const verified = await cycle_recheck.verify(CACHED_RED, options)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(UNTOUCHED_SIDE)
	})
})

describe('cycle_recheck.verify — a cycle closed by editing one side', () => {
	it('drops the report the cache still holds for the untouched side', async () => {
		writeFileSync(path.join(root, EDITED_SIDE), ACYCLIC_A)

		await expect(cached_cycle_files()).resolves.toEqual([UNTOUCHED_SIDE])

		const verified = await cycle_recheck.verify(CACHED_RED, options)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})

	// `josh lint:related`: both sides were in the change, so both are named again and the untouched
	// one still answers from the cache.
	it('drops it for a run narrowed to the two files as well', async () => {
		const narrowed = { ...options, patterns: [EDITED_SIDE, UNTOUCHED_SIDE] }

		const verified = await cycle_recheck.verify(CACHED_RED, narrowed)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})
})

describe('cycle_recheck.verify — a run that reports no cycle', () => {
	it.each([
		['a green run', { output: '', exit_code: 0, elapsed_ms: 0 }],
		['a red run about another rule', { output: 'no-console', exit_code: 1, elapsed_ms: 0 }],
		['a green run that only mentions the rule', { ...CACHED_RED, exit_code: 0 }],
		['a run that crashed while naming the rule', { ...CACHED_RED, exit_code: 2 }],
		['a run killed before it exited', { ...CACHED_RED, exit_code: undefined }],
	])('hands %s back untouched', async (_label, result) => {
		const lint_files = vi.spyOn(ESLint.prototype, 'lintFiles')

		await expect(cycle_recheck.verify(result, options)).resolves.toBe(result)
		expect(lint_files).not.toHaveBeenCalled()
	})
})

// `eslint` is an optional peer, and `josh lint` imports this module in a basic-profile project that
// does not have it: the module has to load there, and a run that reports no cycle has to pass
// through, so the linter is loaded only once a cycle report is being re-read.
describe('cycle_recheck — a project without eslint', () => {
	afterAll(() => {
		vi.doUnmock('eslint')
		vi.resetModules()
	})

	it('loads and hands a green run back without loading the linter', async () => {
		const green: BufferedProcessResult = { output: '', exit_code: 0, elapsed_ms: 0 }

		vi.resetModules()
		vi.doMock('eslint', () => {
			throw new Error('Cannot find package eslint')
		})
		const reloaded = await import('./cycle-recheck')

		await expect(reloaded.cycle_recheck.verify(green, options)).resolves.toBe(green)
		await expect(reloaded.cycle_recheck.verify(CACHED_RED, options)).rejects.toThrow()
	})
})
