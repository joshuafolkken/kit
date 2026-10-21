import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { create_base_config } from '#eslint/base.js'
import type { BufferedProcessResult } from '#scripts/lib/buffered-process'
import { ESLint } from 'eslint'
import ts from 'typescript-eslint'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cross_file_recheck, type CrossFileRecheckOptions } from './cross-file-recheck'

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
const created_root = mkdtempSync(path.join(tmpdir(), 'kit-cross-file-recheck-'))
const root = realpathSync(created_root)
const cache_file = path.join(root, '.eslintcache')

for (const [name, source] of FIXTURE_FILES) {
	writeFileSync(path.join(root, name), source)
}

// `no-cycle` reads the import graph, not types, so the typed parser is switched off rather than
// handed a tsconfig project to build for three-line files.
//
// `disallowAutomaticSingleRunInference`: under `CI=true` typescript-eslint takes the process for one
// CLI run, and a file parsed a second time in it gets a single-file fallback program — which a
// type-aware rule then reads, and `sonarjs/deprecation` throws on. These cases lint the same two
// files over and over in one process, where a lint run parses each once.
const options: CrossFileRecheckOptions = {
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
			{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } },
		],
	},
}

const NO_CYCLE_RULE = 'import/no-cycle'
// The plugin's second name: its own preset's rules, which the base config keeps for a `.js` file.
const NAMED_RULE = 'import-x/named'
const IMPORTER = 'importer.js'
const EXPORTER = 'exporter.js'
const IMPORTER_SOURCE =
	"import { DELTA } from './exporter.js'\n\nexport const EPSILON = DELTA + 1\n"
const WITHOUT_EXPORT = 'export const OTHER = 1\n'
const WITH_EXPORT = `${WITHOUT_EXPORT}\nexport const DELTA = 2\n`
// A rule that reads the linted file alone, and a file that is clean but for it.
const OWN_FILE_RULE = 'no-debugger'
const OWN_FILE_RED = 'c.ts'
const OWN_FILE_RED_SOURCE = 'debugger\n\nexport const GAMMA = 1\n'
// A file no configuration matches: named, it draws a warning that carries no rule.
const UNMATCHED_FILE = 'notes.txt'
// eslint's default suppressions file, which its CLI applies whenever it exists.
const SUPPRESSIONS_FILE = 'eslint-suppressions.json'

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

describe('cross_file_recheck.verify — a cycle that is there', () => {
	it('reports it when no cache file exists yet', async () => {
		const verified = await cross_file_recheck.verify(CACHED_RED, options)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(NO_CYCLE_RULE)
		expect(existsSync(cache_file)).toBe(true)
	})

	it('reports it again from the cache file the first run wrote', async () => {
		const verified = await cross_file_recheck.verify(CACHED_RED, options)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(UNTOUCHED_SIDE)
	})

	// joshuafolkken/kit#4407: the pre-commit hook's `--quiet` run hides a warning with no rule, such as
	// the notice for a named file no configuration matches.
	it('keeps the error results alone when asked as a `--quiet` run', async () => {
		writeFileSync(path.join(root, UNMATCHED_FILE), 'notes\n')
		const named = { ...options, patterns: [UNTOUCHED_SIDE, UNMATCHED_FILE] }

		const loud = await cross_file_recheck.verify(CACHED_RED, named)
		const quiet = await cross_file_recheck.verify(CACHED_RED, { ...named, errors_only: true })

		expect(loud.output).toContain(UNMATCHED_FILE)
		expect(quiet.output).toContain(NO_CYCLE_RULE)
		expect(quiet.output).not.toContain(UNMATCHED_FILE)
		expect(quiet.exit_code).toBe(1)
	})

	// joshuafolkken/kit#4407: the CLI run applies the suppressions file, so the re-read report does too.
	it('keeps out a violation the suppressions file holds, as the CLI run does', async () => {
		const suppressions = path.join(root, SUPPRESSIONS_FILE)

		writeFileSync(
			suppressions,
			JSON.stringify({ [UNTOUCHED_SIDE]: { [NO_CYCLE_RULE]: { count: 1 } } }),
		)
		const verified = await cross_file_recheck.verify(CACHED_RED, options)

		rmSync(suppressions)
		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(path.join(root, EDITED_SIDE))
		expect(verified.output).not.toContain(path.join(root, UNTOUCHED_SIDE))
	})
})

describe('cross_file_recheck.verify — a cycle closed by editing one side', () => {
	it('drops the report the cache still holds for the untouched side', async () => {
		writeFileSync(path.join(root, EDITED_SIDE), ACYCLIC_A)

		await expect(cached_cycle_files()).resolves.toEqual([UNTOUCHED_SIDE])

		const verified = await cross_file_recheck.verify(CACHED_RED, options)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})

	// `josh lint:related`: both sides were in the change, so both are named again and the untouched
	// one still answers from the cache.
	it('drops it for a run narrowed to the two files as well', async () => {
		const narrowed = { ...options, patterns: [EDITED_SIDE, UNTOUCHED_SIDE] }

		const verified = await cross_file_recheck.verify(CACHED_RED, narrowed)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})
})

// Narrowed to the importer, so the untouched side's withdrawn cycle report stays out of the answer.
describe('cross_file_recheck.verify — a name the imported file did not export yet', () => {
	const narrowed = { ...options, patterns: [IMPORTER] }

	it('reports it under the plugin’s own rule name while the export is missing', async () => {
		writeFileSync(path.join(root, EXPORTER), WITHOUT_EXPORT)
		writeFileSync(path.join(root, IMPORTER), IMPORTER_SOURCE)

		const verified = await cross_file_recheck.verify(CACHED_RED, narrowed)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(NAMED_RULE)
	})

	it('drops the report the cache still holds for the importer once it is exported', async () => {
		writeFileSync(path.join(root, EXPORTER), WITH_EXPORT)

		const verified = await cross_file_recheck.verify(CACHED_RED, narrowed)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})
})

// joshuafolkken/kit#3667: the red is read off the cache rather than off the report's text, so a
// rule that reads nothing else costs the cached asking and no second lint.
describe('cross_file_recheck.verify — a red about the linted file alone', () => {
	afterAll(() => {
		rmSync(path.join(root, OWN_FILE_RED))
	})

	// Narrowed to the one file: the cache still holds the untouched side's withdrawn cycle report.
	it('hands the report back as the run wrote it, linting nothing afresh', async () => {
		writeFileSync(path.join(root, OWN_FILE_RED), OWN_FILE_RED_SOURCE)
		const result = { output: OWN_FILE_RULE, exit_code: 1, elapsed_ms: 0 }
		const narrowed = { ...options, patterns: [OWN_FILE_RED] }
		const lint_files = vi.spyOn(ESLint.prototype, 'lintFiles')

		await expect(cross_file_recheck.verify(result, narrowed)).resolves.toBe(result)
		expect(lint_files).toHaveBeenCalledTimes(1)
		await expect(lint_files.mock.results[0]?.value).resolves.toContainEqual(
			expect.objectContaining({ filePath: path.join(root, OWN_FILE_RED), errorCount: 1 }),
		)
	})
})

describe('cross_file_recheck.verify — a run that is not red', () => {
	it.each([
		['a green run', { output: '', exit_code: 0, elapsed_ms: 0 }],
		['a green run that only mentions the rule', { ...CACHED_RED, exit_code: 0 }],
		['a run that crashed while naming the rule', { ...CACHED_RED, exit_code: 2 }],
		['a run killed before it exited', { ...CACHED_RED, exit_code: undefined }],
	])('hands %s back untouched', async (_label, result) => {
		const lint_files = vi.spyOn(ESLint.prototype, 'lintFiles')

		await expect(cross_file_recheck.verify(result, options)).resolves.toBe(result)
		expect(lint_files).not.toHaveBeenCalled()
	})
})

// `eslint` is an optional peer, and `josh lint` imports this module in a basic-profile project that
// does not have it: the module has to load there, and a run that is not red has to pass
// through, so the linter is loaded only once a red report is being re-read.
describe('cross_file_recheck — a project without eslint', () => {
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
		const reloaded = await import('./cross-file-recheck')

		await expect(reloaded.cross_file_recheck.verify(green, options)).resolves.toBe(green)
		await expect(reloaded.cross_file_recheck.verify(CACHED_RED, options)).rejects.toThrow()
	})
})
