import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	has_svelte_config_file,
	is_sveltekit_project,
	PACKAGE_DIR,
	package_path,
	PROJECT_ROOT,
	svelte_config_import,
} from './init-paths'

describe('PACKAGE_DIR', () => {
	it('is an absolute path', () => {
		expect(path.isAbsolute(PACKAGE_DIR)).toBe(true)
	})
})

describe('PROJECT_ROOT', () => {
	it('equals process.cwd()', () => {
		expect(PROJECT_ROOT).toBe(process.cwd())
	})
})

describe('package_path', () => {
	it('joins PACKAGE_DIR with a relative path', () => {
		expect(package_path('foo/bar')).toBe(path.join(PACKAGE_DIR, 'foo/bar'))
	})
})

const PROJECT_TYPE_TEST_DIR = path.join(tmpdir(), 'init-paths-project-type-test')
const PACKAGE_JSON_FILE = 'package.json'
const SVELTEKIT_PACKAGE = '@sveltejs/kit'
const SVELTE_CONFIG_JS = 'svelte.config.js'
const SVELTE_CONFIG_TS = 'svelte.config.ts'
const EMPTY_CONTENT = ''
const JS_EXISTS_TITLE = 'returns true when svelte.config.js exists'
const TS_EXISTS_TITLE = 'returns true when svelte.config.ts exists'
const SVELTEKIT_DEV_DEP = { devDependencies: { [SVELTEKIT_PACKAGE]: '^2.0.0' } }

function write_project_file(filename: string, content: string): void {
	writeFileSync(path.join(PROJECT_TYPE_TEST_DIR, filename), content)
}

function write_project_package_json(value: Record<string, unknown>): void {
	write_project_file(PACKAGE_JSON_FILE, JSON.stringify(value))
}

describe('is_sveltekit_project', () => {
	beforeEach(() => {
		mkdirSync(PROJECT_TYPE_TEST_DIR, { recursive: true })
	})

	afterEach(() => {
		rmSync(PROJECT_TYPE_TEST_DIR, { recursive: true, force: true })
	})

	it(JS_EXISTS_TITLE, () => {
		write_project_file(SVELTE_CONFIG_JS, EMPTY_CONTENT)
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it(TS_EXISTS_TITLE, () => {
		write_project_file(SVELTE_CONFIG_TS, EMPTY_CONTENT)
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns true when @sveltejs/kit is a devDependency without svelte.config', () => {
		write_project_package_json(SVELTEKIT_DEV_DEP)
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns true when @sveltejs/kit is a dependency without svelte.config', () => {
		write_project_package_json({ dependencies: { [SVELTEKIT_PACKAGE]: '^2.0.0' } })
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns false when package.json lacks @sveltejs/kit and no svelte.config', () => {
		write_project_package_json({ devDependencies: { vite: '^5.0.0' } })
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(false)
	})

	it('returns false when no svelte.config.{js,ts} exists', () => {
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(false)
	})
})

describe('has_svelte_config_file', () => {
	beforeEach(() => {
		mkdirSync(PROJECT_TYPE_TEST_DIR, { recursive: true })
	})

	afterEach(() => {
		rmSync(PROJECT_TYPE_TEST_DIR, { recursive: true, force: true })
	})

	it(JS_EXISTS_TITLE, () => {
		write_project_file(SVELTE_CONFIG_JS, EMPTY_CONTENT)
		expect(has_svelte_config_file(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it(TS_EXISTS_TITLE, () => {
		write_project_file(SVELTE_CONFIG_TS, EMPTY_CONTENT)
		expect(has_svelte_config_file(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns false when no svelte.config file exists even with @sveltejs/kit', () => {
		write_project_package_json(SVELTEKIT_DEV_DEP)
		expect(has_svelte_config_file(PROJECT_TYPE_TEST_DIR)).toBe(false)
	})
})

describe('svelte_config_import', () => {
	beforeEach(() => {
		mkdirSync(PROJECT_TYPE_TEST_DIR, { recursive: true })
	})

	afterEach(() => {
		rmSync(PROJECT_TYPE_TEST_DIR, { recursive: true, force: true })
	})

	it('returns the .js specifier when svelte.config.js exists', () => {
		write_project_file(SVELTE_CONFIG_JS, EMPTY_CONTENT)
		expect(svelte_config_import(PROJECT_TYPE_TEST_DIR)).toBe(`./${SVELTE_CONFIG_JS}`)
	})

	it('returns the .ts specifier when only svelte.config.ts exists', () => {
		write_project_file(SVELTE_CONFIG_TS, EMPTY_CONTENT)
		expect(svelte_config_import(PROJECT_TYPE_TEST_DIR)).toBe(`./${SVELTE_CONFIG_TS}`)
	})

	it('returns undefined when no svelte.config file exists', () => {
		write_project_package_json(SVELTEKIT_DEV_DEP)
		expect(svelte_config_import(PROJECT_TYPE_TEST_DIR)).toBeUndefined()
	})
})
