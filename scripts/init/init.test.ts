import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init } from './init'
import { PROJECT_ROOT } from './init-paths'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

function fake_lefthook_result(exit_code: number | undefined): ReturnType<typeof execaSync> {
	const result = { exitCode: exit_code }

	return result as unknown as ReturnType<typeof execaSync>
}

// Unique per run, guarded by `shared-temporary-path.test.ts` (joshuafolkken/kit#1517).
const TEST_DIR = mkdtempSync(path.join(tmpdir(), 'init-test-'))
const TEMPLATE_PATH = path.join(TEST_DIR, 'template.properties')
const DEST_PATH = path.join(TEST_DIR, 'sonar-project.properties')

beforeEach(() => {
	mkdirSync(TEST_DIR, { recursive: true })
})

afterEach(() => {
	rmSync(TEST_DIR, { recursive: true, force: true })
})

const AI_COPY_SOURCE = readFileSync(
	fileURLToPath(new URL('init-ai-copy.ts', import.meta.url)),
	'utf8',
)

describe('skip messages', () => {
	it('reference josh sync not pnpm sync', () => {
		expect(AI_COPY_SOURCE).not.toContain('pnpm sync')
	})

	it('does not suggest sync for a skipped file', () => {
		expect(AI_COPY_SOURCE).toContain('(already exists)')
	})

	it('contain josh sync in summary tip message', () => {
		expect(AI_COPY_SOURCE).toContain('Run `josh sync`')
	})
})

const NO_REFERENCES_CONTENT = 'no references here\n'

describe('install_lefthook', () => {
	it('does not warn when lefthook installs successfully', () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_execa_sync.mockReturnValue(fake_lefthook_result(0))
		init.install_lefthook()

		expect(warn_spy).not.toHaveBeenCalled()
		warn_spy.mockRestore()
	})

	// Only the `.cmd` shim is executable on Windows, so the spawned path has to come from the
	// shared resolver rather than a hardcoded extensionless name.
	it('spawns the platform-correct lefthook shim', () => {
		const shim = process.platform === 'win32' ? 'lefthook.cmd' : 'lefthook'

		mocked_execa_sync.mockReturnValue(fake_lefthook_result(0))
		init.install_lefthook()

		expect(mocked_execa_sync.mock.lastCall?.[0]).toBe(
			path.join(PROJECT_ROOT, 'node_modules', '.bin', shim),
		)
	})

	// `init` runs before the first `pnpm install`, whose `prepare` installs the hooks (#2710).
	it('explains instead of warning when lefthook is not installed yet', () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const info_spy = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		mocked_execa_sync.mockClear()
		init.install_lefthook(TEST_DIR)

		expect(mocked_execa_sync).not.toHaveBeenCalled()
		expect(warn_spy).not.toHaveBeenCalled()
		expect(info_spy).toHaveBeenCalledWith(expect.stringContaining('pnpm install'))
		warn_spy.mockRestore()
		info_spy.mockRestore()
	})

	it('warns when the lefthook binary cannot be spawned (exitCode undefined)', () => {
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		mocked_execa_sync.mockReturnValue(fake_lefthook_result(undefined))
		init.install_lefthook()

		expect(warn_spy).toHaveBeenCalled()
		warn_spy.mockRestore()
	})
})

const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const KIT_PACKAGE_JSON_PATH = fileURLToPath(new URL('../../package.json', import.meta.url))
const KIT_VERSION = (JSON.parse(readFileSync(KIT_PACKAGE_JSON_PATH, 'utf8')) as { version: string })
	.version
const KIT_MANIFEST = JSON.parse(readFileSync(KIT_PACKAGE_JSON_PATH, 'utf8')) as {
	peerDependencies: Record<string, string>
	devDependencies: Record<string, string>
}

function merge_development_dependencies(content: string): Record<string, string> {
	const merged = init.apply_package_json_merges(content)

	return (JSON.parse(merged) as { devDependencies: Record<string, string> }).devDependencies
}

describe('apply_package_json_merges', () => {
	it('adds @joshuafolkken/kit at the kit version', () => {
		expect(merge_development_dependencies('{}\n')[KIT_PACKAGE_NAME]).toBe(KIT_VERSION)
	})

	it('does not overwrite an existing @joshuafolkken/kit pin', () => {
		const existing = `${JSON.stringify({ devDependencies: { [KIT_PACKAGE_NAME]: '0.1.0' } })}\n`

		expect(merge_development_dependencies(existing)[KIT_PACKAGE_NAME]).toBe('0.1.0')
	})

	// A version below the peer floor makes the consumer's install warn on an unmet peer (#3085).
	it.each([
		'@ianvs/prettier-plugin-sort-imports',
		'prettier-plugin-svelte',
		'prettier-plugin-tailwindcss',
	])('adds the prettier preset plugin %s at the kit development version', (name: string) => {
		expect(merge_development_dependencies('{}\n')[name]).toBe(KIT_MANIFEST.devDependencies[name])
	})

	it('adds every public peer from the kit development versions', () => {
		const deps = merge_development_dependencies('{}\n')

		for (const name of Object.keys(KIT_MANIFEST.peerDependencies)) {
			expect(deps[name]).toBe(KIT_MANIFEST.devDependencies[name])
		}
	})

	it('preserves an existing ESLint version during migration', () => {
		const existing = JSON.stringify({ devDependencies: { eslint: '^10.0.0' } })

		expect(merge_development_dependencies(existing)['eslint']).toBe('^10.0.0')
	})

	// The pre-commit secretlint rule shipped in lefthook/base.yml resolves both packages
	// from the consumer, so init must provision them alongside the config file.
	it('adds the secretlint CLI and rule preset', () => {
		const deps = merge_development_dependencies('{}\n')

		expect(deps['secretlint']).toBeDefined()
		expect(deps['@secretlint/secretlint-rule-preset-recommend']).toBeDefined()
	})
})

const PLAYWRIGHT_CONFIG = 'playwright.config.ts'

// Each generated config needs its tool resolvable from the consumer, or the first `josh gate`
// after `pnpm install` fails (#2710).
describe('apply_package_json_merges — generated config dependencies', () => {
	it.each([
		['prettier.config.js', 'prettier'],
		['cspell.config.yaml', 'cspell'],
		[PLAYWRIGHT_CONFIG, '@playwright/test'],
		[PLAYWRIGHT_CONFIG, '@types/node'],
		['lefthook.yml', 'lefthook'],
	])('adds the dependency %s needs: %s', (_config, name) => {
		expect(merge_development_dependencies('{}\n')[name]).toBe(KIT_MANIFEST.devDependencies[name])
	})

	it('adds no lefthook to a project without Git, which gets no lefthook.yml', () => {
		const merged = init.apply_package_json_merges('{}\n', false)
		const parsed = JSON.parse(merged) as { devDependencies: Record<string, string> }

		expect(parsed.devDependencies['lefthook']).toBeUndefined()
		expect(parsed.devDependencies['prettier']).toBeDefined()
	})
})

const PUBLISHED_PIN = '12.6.0+sha512.abc'
const PACKAGE_MANAGER_FIELD = 'pnpm@12.7.0'

// pnpm strips `packageManager` when it publishes, so the installed kit carries its pin only in
// `devEngines`; the consumer used to get the bare `>=12.1.0` range instead (#2710).
describe('resolve_kit_package_manager', () => {
	it('prefers the packageManager field', () => {
		const manifest = { packageManager: PACKAGE_MANAGER_FIELD }

		expect(init.resolve_kit_package_manager(manifest)).toBe(PACKAGE_MANAGER_FIELD)
	})

	it('falls back to the exact devEngines pin of a published manifest', () => {
		const manifest = { devEngines: { packageManager: { name: 'pnpm', version: PUBLISHED_PIN } } }

		expect(init.resolve_kit_package_manager(manifest)).toBe(`pnpm@${PUBLISHED_PIN}`)
	})

	it('answers nothing when neither is declared', () => {
		expect(init.resolve_kit_package_manager({})).toBeUndefined()
	})
})

describe('copy_ai_file', () => {
	it('writes file content to destination', () => {
		writeFileSync(TEMPLATE_PATH, NO_REFERENCES_CONTENT)
		init.copy_ai_file(TEMPLATE_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(NO_REFERENCES_CONTENT)
	})

	it('transforms prompts/ references to node_modules package path', () => {
		writeFileSync(TEMPLATE_PATH, 'see `prompts/refactoring.md`\n')
		init.copy_ai_file(TEMPLATE_PATH, DEST_PATH)

		expect(readFileSync(DEST_PATH, 'utf8')).toBe(
			'see `node_modules/@joshuafolkken/kit/prompts/refactoring.md`\n',
		)
	})

	it('creates destination directory when it does not exist', () => {
		const nested_destination = path.join(TEST_DIR, 'nested', 'dir', 'CLAUDE.md')

		writeFileSync(TEMPLATE_PATH, 'content\n')
		init.copy_ai_file(TEMPLATE_PATH, nested_destination)

		expect(existsSync(nested_destination)).toBe(true)
	})
})
