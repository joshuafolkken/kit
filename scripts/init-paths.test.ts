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

describe('is_sveltekit_project', () => {
	beforeEach(() => {
		mkdirSync(PROJECT_TYPE_TEST_DIR, { recursive: true })
	})

	afterEach(() => {
		rmSync(PROJECT_TYPE_TEST_DIR, { recursive: true, force: true })
	})

	it('returns true when svelte.config.js exists', () => {
		writeFileSync(path.join(PROJECT_TYPE_TEST_DIR, 'svelte.config.js'), '')
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns true when svelte.config.ts exists', () => {
		writeFileSync(path.join(PROJECT_TYPE_TEST_DIR, 'svelte.config.ts'), '')
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(true)
	})

	it('returns false when no svelte.config.{js,ts} exists', () => {
		expect(is_sveltekit_project(PROJECT_TYPE_TEST_DIR)).toBe(false)
	})
})
