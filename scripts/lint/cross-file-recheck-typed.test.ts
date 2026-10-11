import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLINT_CACHE_FILE, ESLINT_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import type { BufferedProcessResult } from '#scripts/lib/buffered-process'
import { ESLint } from 'eslint'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cross_file_recheck, type CrossFileRecheckOptions } from './cross-file-recheck'

// joshuafolkken/kit#3667. A type-aware rule reads the type of what the file imports, so its verdict
// is about another file too. The cases lint a real caller on disk against a real cache file and a
// real tsconfig project, for the reason `cross-file-recheck.test.ts` gives: the stale entry is the
// cache file's, and a mocked linter would have no type to resolve.
const LINT_PROBE_TIMEOUT_MS = 120_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const UNSAFE_CALL_RULE = '@typescript-eslint/no-unsafe-call'
const CALLER = 'caller.ts'
const REFERENCED = 'referenced.ts'
// The caller is written first, against a function its module does not export yet.
const WITHOUT_EXPORT = 'const referenced = {}\n\nexport { referenced }\n'
const WITH_EXPORT = [
	'function greet(): string {',
	"\treturn 'hello'",
	'}',
	'',
	'const referenced = { greet }',
	'',
	'export { referenced }',
	'',
].join('\n')
const CALLER_SOURCE = [
	"import { referenced } from './referenced'",
	'',
	'const GREETING: string = referenced.greet()',
	'',
	'export { GREETING }',
	'',
].join('\n')
// `bundler`: the extensionless import has to resolve, or the call is unsafe whatever is exported.
const TSCONFIG = {
	compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
	include: ['*.ts'],
}
const FIXTURE_FILES: Array<[string, string]> = [
	['package.json', JSON.stringify({ type: 'module' })],
	['tsconfig.json', JSON.stringify(TSCONFIG)],
	[CALLER, CALLER_SOURCE],
	[REFERENCED, WITHOUT_EXPORT],
]

// `realpathSync`: see `cross-file-recheck.test.ts`. The configuration sits beside the project, not
// in it, so linting the project's `.` does not lint the configuration file.
const created_root = mkdtempSync(path.join(tmpdir(), 'kit-cross-file-recheck-'))
const project = path.join(realpathSync(created_root), 'project')
const config_file = path.join(realpathSync(created_root), 'eslint.config.js')
const cache_file = path.join(project, ESLINT_CACHE_FILE)

// One configuration file for the lint run and for the re-reading: a cache entry is keyed on the
// configuration too, so a re-reading under another one would miss the stale entry and prove nothing.
//
// `disallowAutomaticSingleRunInference`: see `cross-file-recheck.test.ts` — the re-reading parses
// the caller more than once in this process.
const CONFIG_SOURCE = [
	`import { create_base_config } from ${JSON.stringify(new URL('../../eslint/base.js', import.meta.url).href)}`,
	'',
	'export default [',
	'\t...create_base_config({',
	`\t\tgitignore_path: new URL(${JSON.stringify(new URL('../../.gitignore', import.meta.url).href)}),`,
	`\t\ttsconfig_root_dir: ${JSON.stringify(project)},`,
	'\t}),',
	'\t{ languageOptions: { parserOptions: { disallowAutomaticSingleRunInference: true } } },',
	']',
	'',
].join('\n')

mkdirSync(project)
writeFileSync(config_file, CONFIG_SOURCE)

for (const [name, source] of FIXTURE_FILES) {
	writeFileSync(path.join(project, name), source)
}

const options: CrossFileRecheckOptions = {
	cache_file,
	patterns: ['.'],
	eslint_options: { cwd: project, overrideConfigFile: config_file },
}

// The lint run as `josh lint` starts it: a child process, the same cache flags. It is a process of
// its own here for the reason it is one there — the type program a process builds is kept for its
// lifetime, so a run that saw the missing export has to have ended before the export is added.
function run_lint(): BufferedProcessResult {
	const eslint_bin = path.join(
		path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
		'bin/eslint.js',
	)
	const child = spawnSync(
		process.execPath,
		[eslint_bin, '.', '--config', config_file, ...ESLINT_CACHE_FLAGS],
		{ cwd: project, encoding: 'utf8' },
	)

	return { output: child.stdout, exit_code: child.status ?? undefined, elapsed_ms: 0 }
}

// What the cache file answers, asked the way the lint run asks it.
async function cached_rule_files(rule_id: string): Promise<Array<string>> {
	const linter = new ESLint({
		...options.eslint_options,
		cache: true,
		cacheStrategy: 'content',
		cacheLocation: cache_file,
	})
	const results = await linter.lintFiles(['.'])

	return results
		.filter((result) => result.messages.some((message) => message.ruleId === rule_id))
		.map((result) => path.basename(result.filePath))
}

afterAll(() => {
	rmSync(created_root, { recursive: true, force: true })
})

describe('cross_file_recheck.verify — a call to a function its module does not export', () => {
	// The lint run alone: the re-reading would build this process's type program around the missing
	// export, which is the one thing the cases below need it not to have seen.
	it('is reported by the lint run while the export is missing', () => {
		const linted = run_lint()

		expect(linted.exit_code).toBe(1)
		expect(linted.output).toContain(UNSAFE_CALL_RULE)
	})
})

describe('cross_file_recheck.verify — the export added, the caller untouched', () => {
	it('drops the report the cache still holds for the caller', async () => {
		writeFileSync(path.join(project, REFERENCED), WITH_EXPORT)

		const linted = run_lint()

		expect(linted.exit_code).toBe(1)
		expect(linted.output).toContain(UNSAFE_CALL_RULE)
		await expect(cached_rule_files(UNSAFE_CALL_RULE)).resolves.toEqual([CALLER])

		const verified = await cross_file_recheck.verify(linted, options)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})

	// `josh lint:related`: the caller is named again and still answers from the cache.
	it('drops it for a run narrowed to the caller as well', async () => {
		const narrowed = { ...options, patterns: [CALLER] }

		const verified = await cross_file_recheck.verify(run_lint(), narrowed)

		expect(verified.output).toBe('')
		expect(verified.exit_code).toBe(0)
	})
})

describe('cross_file_recheck.verify — a call the referenced file still does not answer', () => {
	it('keeps the report the fresh lint repeats', async () => {
		writeFileSync(path.join(project, CALLER), CALLER_SOURCE.replace('greet', 'missing'))

		const verified = await cross_file_recheck.verify(run_lint(), options)

		expect(verified.exit_code).toBe(1)
		expect(verified.output).toContain(UNSAFE_CALL_RULE)
	})
})
