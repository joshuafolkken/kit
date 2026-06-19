import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { is_sveltekit_project, PACKAGE_DIR, package_path, PROJECT_ROOT } from './init-paths'

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

	it('returns true when svelte.config.js exists', () => {
		write_project_file('svelte.config.js', '')
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns true when svelte.config.ts exists', () => {
		write_project_file('svelte.config.ts', '')
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns true when @sveltejs/kit is a devDependency without svelte.config', () => {
		write_project_package_json({ devDependencies: { [SVELTEKIT_PACKAGE]: '^2.0.0' } })
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
