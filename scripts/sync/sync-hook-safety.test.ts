import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { afterEach, describe, expect, it } from 'vitest'
import { sync_hook_safety } from './sync-hook-safety'

const WRITING_VERSION = '1.340.0'
const HOOK_FILES = ['.claude/settings.json', '.codex/hooks.json']
const PROJECT_ROOTS = new Set<string>()

afterEach(() => {
	for (const project_root of PROJECT_ROOTS) rmSync(project_root, { recursive: true, force: true })
	PROJECT_ROOTS.clear()
})

function write_installed_version(project_root: string, version: string): void {
	const install_directory = path.join(project_root, 'node_modules', KIT_PACKAGE_NAME)

	mkdirSync(install_directory, { recursive: true })
	writeFileSync(path.join(install_directory, 'package.json'), JSON.stringify({ version }))
}

function project_with_installed_version(version: string | undefined): string {
	const project_root = mkdtempSync(path.join(tmpdir(), 'sync-hook-safety-'))

	PROJECT_ROOTS.add(project_root)
	if (version !== undefined) write_installed_version(project_root, version)

	return project_root
}

describe('is_safe_to_write_hooks', () => {
	it('is unsafe when the installed bundle is older than the version writing the settings', () => {
		expect(sync_hook_safety.is_safe_to_write_hooks(WRITING_VERSION, '1.214.0')).toBe(false)
	})

	it('is safe when the installed bundle is the same version', () => {
		expect(sync_hook_safety.is_safe_to_write_hooks(WRITING_VERSION, WRITING_VERSION)).toBe(true)
	})

	it('is safe when the installed bundle is newer', () => {
		expect(sync_hook_safety.is_safe_to_write_hooks(WRITING_VERSION, '1.400.0')).toBe(true)
	})

	it('is safe when either version cannot be read', () => {
		expect(sync_hook_safety.is_safe_to_write_hooks(undefined, '1.214.0')).toBe(true)
		expect(sync_hook_safety.is_safe_to_write_hooks(WRITING_VERSION, undefined)).toBe(true)
	})
})

describe('installed_consumer_version', () => {
	it('reads the version from the consumer node_modules install', () => {
		const project_root = project_with_installed_version('1.214.0')

		expect(sync_hook_safety.installed_consumer_version(project_root)).toBe('1.214.0')
	})

	it('is undefined when kit is not installed yet', () => {
		const project_root = project_with_installed_version(undefined)

		expect(sync_hook_safety.installed_consumer_version(project_root)).toBeUndefined()
	})
})

describe('hook_write_warning', () => {
	it.each(HOOK_FILES)('warns for %s against an older installed CLI', (filename) => {
		const project_root = project_with_installed_version('1.214.0')
		const warning = sync_hook_safety.hook_write_warning(project_root, WRITING_VERSION, filename)

		expect(warning).toContain(filename)
		expect(warning).toContain('1.214.0')
		expect(warning).toContain('pnpm update')
	})

	it.each(HOOK_FILES)('does not block %s when the installed CLI matches', (filename) => {
		const project_root = project_with_installed_version(WRITING_VERSION)

		expect(
			sync_hook_safety.hook_write_warning(project_root, WRITING_VERSION, filename),
		).toBeUndefined()
	})

	it.each(HOOK_FILES)('does not block %s when kit is not installed yet', (filename) => {
		const project_root = project_with_installed_version(undefined)

		expect(
			sync_hook_safety.hook_write_warning(project_root, WRITING_VERSION, filename),
		).toBeUndefined()
	})
})
