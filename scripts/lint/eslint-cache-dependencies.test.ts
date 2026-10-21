import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ESLINT_CACHE_FILE, ESLINT_CACHE_FLAGS } from '#scripts/josh/josh-command-types'
import type { BufferedProcessResult } from '#scripts/lib/buffered-process'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { eslint_cache_dependencies } from './eslint-cache-dependencies'

// joshuafolkken/kit#4415. Only the file the caller imports changes, and the value it hands over
// becomes `any`: the caller is now an unsafe assignment, while its own content — the cache's key —
// is what it was. The cases lint a real caller against a real cache file and a real tsconfig
// project, for the reason `cross-file-recheck-typed.test.ts` gives.
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

const created_root = mkdtempSync(path.join(tmpdir(), 'kit-eslint-cache-dependencies-'))
const project = path.join(realpathSync(created_root), 'project')
const config_file = path.join(realpathSync(created_root), 'eslint.config.js')
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

// A process of its own per run: the type program a process builds is kept for its lifetime.
function run_eslint(cache_flags: ReadonlyArray<string>): BufferedProcessResult {
	const eslint_bin = path.join(
		path.dirname(createRequire(import.meta.url).resolve('eslint/package.json')),
		'bin/eslint.js',
	)
	const child = spawnSync(
		process.execPath,
		[eslint_bin, '--config', config_file, ...cache_flags, CALLER],
		{ cwd: project, encoding: 'utf8' },
	)

	return { output: child.stdout, exit_code: child.status ?? undefined, elapsed_ms: 0 }
}

async function run_guarded(): Promise<BufferedProcessResult> {
	return await eslint_cache_dependencies.guard(
		ESLINT_CACHE_FILE,
		async () => run_eslint(ESLINT_CACHE_FLAGS),
		project,
	)
}

afterAll(() => {
	rmSync(created_root, { recursive: true, force: true })
})

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
	it('is the stale green an unguarded cached run answers', () => {
		writeFileSync(path.join(project, REFERENCED), ANY_VALUE)

		expect(run_eslint(ESLINT_CACHE_FLAGS).exit_code).toBe(0)
		expect(run_eslint(UNCACHED_FLAGS).output).toContain(UNSAFE_ASSIGNMENT_RULE)
	})

	it('answers red as the uncached run does', async () => {
		const uncached = run_eslint(UNCACHED_FLAGS)
		const guarded = await run_guarded()

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
