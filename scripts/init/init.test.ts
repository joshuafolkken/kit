import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init } from './init'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

function fake_lefthook_result(exit_code: number | undefined): ReturnType<typeof execaSync> {
	const result = { exitCode: exit_code }

	return result as unknown as ReturnType<typeof execaSync>
}

const TEST_DIR = path.join(tmpdir(), 'init-test')
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

	it('contain josh sync in file skip message', () => {
		expect(AI_COPY_SOURCE).toContain('run josh sync to update')
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

function merge_development_dependencies(
	content: string,
	type: 'sveltekit' | 'vanilla',
): Record<string, string> {
	const merged = init.apply_package_json_merges(content, type)

	return (JSON.parse(merged) as { devDependencies: Record<string, string> }).devDependencies
}

describe('apply_package_json_merges', () => {
	it('adds @joshuafolkken/kit at the kit version for a sveltekit project', () => {
		expect(merge_development_dependencies('{}\n', 'sveltekit')[KIT_PACKAGE_NAME]).toBe(KIT_VERSION)
	})

	it('adds @joshuafolkken/kit at the kit version for a vanilla project', () => {
		expect(merge_development_dependencies('{}\n', 'vanilla')[KIT_PACKAGE_NAME]).toBe(KIT_VERSION)
	})

	it('does not overwrite an existing @joshuafolkken/kit pin', () => {
		const existing = `${JSON.stringify({ devDependencies: { [KIT_PACKAGE_NAME]: '0.1.0' } })}\n`

		expect(merge_development_dependencies(existing, 'vanilla')[KIT_PACKAGE_NAME]).toBe('0.1.0')
	})

	it('adds the prettier preset plugins for a sveltekit project', () => {
		const deps = merge_development_dependencies('{}\n', 'sveltekit')

		expect(deps['@ianvs/prettier-plugin-sort-imports']).toBe('^4.7.1')
		expect(deps['prettier-plugin-svelte']).toBe('^4.1.1')
		expect(deps['prettier-plugin-tailwindcss']).toBe('^0.8.0')
	})

	it('adds the prettier preset plugins for a vanilla project', () => {
		const deps = merge_development_dependencies('{}\n', 'vanilla')

		expect(deps['@ianvs/prettier-plugin-sort-imports']).toBe('^4.7.1')
		expect(deps['prettier-plugin-svelte']).toBe('^4.1.1')
		expect(deps['prettier-plugin-tailwindcss']).toBe('^0.8.0')
	})
})

const WRANGLER_TYPES = 'wrangler types'
const SVELTE_KIT_SYNC = 'svelte-kit sync'

function merge_scripts(content: string, is_wrangler: boolean): Record<string, string> {
	const merged = init.apply_package_json_merges(content, 'sveltekit', is_wrangler)

	return (JSON.parse(merged) as { scripts: Record<string, string> }).scripts
}

describe('apply_package_json_merges wrangler migration', () => {
	const WRANGLER_PROJECT = JSON.stringify({
		scripts: {
			build: `${WRANGLER_TYPES} && vite build && pnpm run prepack`,
			prepare: SVELTE_KIT_SYNC,
		},
	})

	it('moves wrangler types from build to prepare when is_wrangler is true', () => {
		const scripts = merge_scripts(WRANGLER_PROJECT, true)

		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(scripts['build']).toBe('vite build && pnpm run prepack')
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(scripts['prepare']).toContain(WRANGLER_TYPES)
	})

	it('leaves build and prepare wrangler-free when is_wrangler is false', () => {
		const scripts = merge_scripts(WRANGLER_PROJECT, false)

		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(scripts['build']).toContain(WRANGLER_TYPES)
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation per noPropertyAccessFromIndexSignature
		expect(scripts['prepare']).not.toContain(WRANGLER_TYPES)
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
