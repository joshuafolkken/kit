import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { ESLINT_CACHE_FILE } from '#scripts/josh/josh-command-types'
import type { BufferedProcessResult } from '#scripts/lib/buffered-process'
import { temporary_directory } from '#tools/test/temporary-directory'
import { ESLint } from 'eslint'
import { execa } from 'execa'
import { describe, expect, it, vi } from 'vitest'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'

// joshuafolkken/kit#4415. Only the file the caller imports changes, and the value it hands over
// becomes `any`: the caller is now an unsafe assignment, while its own content — the cache's key —
// is what it was. The cases lint a real caller against a real cache file and a real tsconfig
// project: a mocked linter would have no stale entry to answer with.
const LINT_PROBE_TIMEOUT_MS = 120_000

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const UNSAFE_ASSIGNMENT_RULE = '@typescript-eslint/no-unsafe-assignment'
const CALLER = 'caller.ts'
const REFERENCED = 'referenced.ts'
const TYPED_VALUE = 'const value: number = 1\n\nexport { value }\n'
const ANY_VALUE = "const value = JSON.parse('1')\n\nexport { value }\n"
const CALLER_SOURCE = [
	"import { value } from './referenced'",
	'',
	'const COPY = value',
	'',
	'export { COPY }',
	'',
].join('\n')
const TSCONFIG = {
	compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
	include: ['*.ts'],
}

const make_directory = temporary_directory('suite')
const created_root = realpathSync(make_directory('kit-eslint-cache-dependencies-'))
const project = path.join(created_root, 'project')
const config_file = path.join(created_root, 'eslint.config.js')
const cache_file = path.join(project, ESLINT_CACHE_FILE)
const UNCACHED_FLAGS = ['--cache-location', `${ESLINT_CACHE_FILE}.uncached`]

// The configuration sits beside the project so the run lints the caller alone, as the pre-commit
// hook lints only what is staged.
const CONFIG_SOURCE = [
	`import { create_base_config } from ${JSON.stringify(new URL('../../eslint/base.js', import.meta.url).href)}`,
	'',
	'export default create_base_config({',
	`\tgitignore_path: new URL(${JSON.stringify(new URL('../../.gitignore', import.meta.url).href)}),`,
	`\ttsconfig_root_dir: ${JSON.stringify(project)},`,
	'})',
	'',
].join('\n')

mkdirSync(project)
writeFileSync(config_file, CONFIG_SOURCE)
writeFileSync(path.join(project, 'package.json'), JSON.stringify({ type: 'module' }))
writeFileSync(path.join(project, 'tsconfig.json'), JSON.stringify(TSCONFIG))
writeFileSync(path.join(project, CALLER), CALLER_SOURCE)
writeFileSync(path.join(project, REFERENCED), TYPED_VALUE)

// The ESLint API spelling of `ESLINT_CACHE_FLAGS` and `UNCACHED_FLAGS`.
const CACHED_OPTIONS: ESLint.Options = {
	cache: true,
	cacheStrategy: 'content',
	cacheLocation: ESLINT_CACHE_FILE,
}
const UNCACHED_OPTIONS: ESLint.Options = { cache: false }

function has_clear_caches(parser: unknown): parser is { clearCaches: () => void } {
	return typeof parser === 'object' && parser !== null && 'clearCaches' in parser
}

// typescript-eslint's `parser` export carries no cache clear; the parser package it loads does, and
// is resolved from typescript-eslint so the clear reaches the instance the config parses with.
function clear_type_programs(): void {
	const require_from_plugin = createRequire(
		createRequire(import.meta.url).resolve('typescript-eslint'),
	)
	const parser: unknown = require_from_plugin('@typescript-eslint/parser')

	if (!has_clear_caches(parser)) throw new Error('@typescript-eslint/parser exposes no clearCaches')

	parser.clearCaches()
}

// In this process, as the CLI lints: typescript-eslint keeps the type program it built for the
// process's lifetime, so each run clears it first and reads the files as they are now. One run at a
// time, since a clear would pull the program from under a run beside it.
async function lint_in_process(options: ESLint.Options): Promise<BufferedProcessResult> {
	clear_type_programs()

	const eslint = new ESLint({ ...options, cwd: project, overrideConfigFile: config_file })
	const results = await eslint.lintFiles([CALLER])
	const formatter = await eslint.loadFormatter('stylish')
	const output = await formatter.format(results)

	return {
		output,
		exit_code: results.some(({ errorCount }) => errorCount > 0) ? 1 : 0,
		elapsed_ms: 0,
	}
}

// The CLI itself, in a process of its own, for the case that holds the in-process run to it. An
// uncached run (`UNCACHED_FLAGS` names no `--cache`) reads and writes no cache file, so it starts
// beside a cached one.
async function run_eslint(cache_flags: ReadonlyArray<string>): Promise<BufferedProcessResult> {
	const eslint_bin = path.join(
		path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
		'bin/eslint.js',
	)
	const child = await execa(
		process.execPath,
		[eslint_bin, '--config', config_file, ...cache_flags, CALLER],
		{ cwd: project, reject: false, stripFinalNewline: false },
	)

	return { output: child.stdout, exit_code: child.exitCode, elapsed_ms: 0 }
}

async function run_guarded(): Promise<BufferedProcessResult> {
	return await eslint_cache_dependencies.guard(
		ESLINT_CACHE_FILE,
		async () => await lint_in_process(CACHED_OPTIONS),
		project,
	)
}

describe('eslint_cache_dependencies.guard — the imports unchanged', () => {
	it('lints the caller green and caches it', async () => {
		const linted = await run_guarded()

		expect(linted.output).toBe('')
		expect(linted.exit_code).toBe(0)
	})

	it('leaves the cache file as it was on a run where nothing changed', async () => {
		const before = readFileSync(cache_file, 'utf8')

		await run_guarded()

		expect(readFileSync(cache_file, 'utf8')).toBe(before)
	})
})

describe('eslint_cache_dependencies.guard — only the imported file changed', () => {
	it('is the stale green an unguarded cached run answers', async () => {
		writeFileSync(path.join(project, REFERENCED), ANY_VALUE)

		const cached = await lint_in_process(CACHED_OPTIONS)
		const uncached = await lint_in_process(UNCACHED_OPTIONS)

		expect(cached.exit_code).toBe(0)
		expect(uncached.output).toContain(UNSAFE_ASSIGNMENT_RULE)
	})

	// The uncached run here is the CLI's, so the guarded in-process run answers as the CLI does.
	it('answers red as the uncached run does', async () => {
		const [uncached, guarded] = await Promise.all([run_eslint(UNCACHED_FLAGS), run_guarded()])

		expect(guarded.exit_code).toBe(uncached.exit_code)
		expect(guarded.exit_code).toBe(1)
		expect(guarded.output).toContain(UNSAFE_ASSIGNMENT_RULE)
	})

	it('keeps answering red from the cache it recorded', async () => {
		const guarded = await run_guarded()

		expect(guarded.exit_code).toBe(1)
		expect(guarded.output).toContain(UNSAFE_ASSIGNMENT_RULE)
	})

	it('answers green again once the import is typed again', async () => {
		writeFileSync(path.join(project, REFERENCED), TYPED_VALUE)

		const guarded = await run_guarded()

		expect(guarded.exit_code).toBe(0)
	})
})

// joshuafolkken/kit#4497: a cache file of another layout, or a corrupt one, is removed before the run
// rather than left to eslint, so the run rebuilds it with every entry hashed.
describe('eslint_cache_dependencies.guard — a cache file it cannot read', () => {
	it('removes the file before the run', async () => {
		writeFileSync(cache_file, '{"not": "a cache"')

		const is_present = await eslint_cache_dependencies.guard(
			ESLINT_CACHE_FILE,
			async () => existsSync(cache_file),
			project,
		)

		expect(is_present).toBe(false)
	})

	it('rebuilds a cache whose entries carry the hash', async () => {
		writeFileSync(cache_file, 'not flatted')

		const guarded = await run_guarded()

		expect(guarded.exit_code).toBe(0)
		expect(readFileSync(cache_file, 'utf8')).toContain('"dependencies"')
	})
})

describe('eslint_cache_dependencies.guard — a project with no tsconfig.json', () => {
	it('runs the work as it is, touching no cache file', async () => {
		const bare = path.join(realpathSync(created_root), 'bare')

		mkdirSync(bare)

		const answered = await eslint_cache_dependencies.guard(
			ESLINT_CACHE_FILE,
			async () => 'ran',
			bare,
		)

		expect(answered).toBe('ran')
	})
})

async function counted_drop(): Promise<unknown> {
	const { drop } = await eslint_cache_dependencies.guard_counted(
		ESLINT_CACHE_FILE,
		async () => 'ran',
		project,
	)

	return drop
}

// joshuafolkken/kit#6984: a slow CI lint is read against how many entries the drop sent back to eslint.
describe('eslint_cache_dependencies.guard_counted — the drop it answers', () => {
	it('answers no entry dropped while the imports hash as recorded', async () => {
		writeFileSync(path.join(project, REFERENCED), TYPED_VALUE)
		await run_guarded()

		expect(await counted_drop()).toEqual({ dropped: 0, total: 1 })
	})

	it('answers the entry whose import changed as dropped', async () => {
		writeFileSync(path.join(project, REFERENCED), ANY_VALUE)

		expect(await counted_drop()).toEqual({ dropped: 1, total: 1 })
	})
})
