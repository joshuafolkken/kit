import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { afterAll, describe, expect, it } from 'vitest'
import { project_profile } from './project-profile'

const roots: Array<string> = []
const INDEX_HTML = 'index.html'
const INDEX_CONTENT = '<h1>hello</h1>'
const NO_INSTALL = '--no-install'
const PROFILE_FLAG = '--profile'

function fixture(manifest?: Record<string, unknown>): string {
	const root = mkdtempSync(path.join(os.tmpdir(), 'josh-profile-'))

	roots.push(root)

	if (manifest !== undefined) {
		writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest))
	}

	return root
}

afterAll(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('project profile', () => {
	it('uses an explicit profile before a recorded profile', () => {
		const root = fixture({ josh: { profile: 'full' } })

		expect(project_profile.resolve_profile(root, 'basic')).toEqual({
			profile: 'basic',
			reason: 'explicit --profile',
		})
	})
	it('keeps the recorded profile after dependencies appear', () => {
		const root = fixture({ josh: { profile: 'basic' }, dependencies: { vite: '^1' } })

		expect(project_profile.resolve_profile(root).profile).toBe('basic')
	})
	it('selects basic without a package manifest', () => {
		expect(project_profile.resolve_profile(fixture()).profile).toBe('basic')
	})
	it('selects basic when kit is the only dependency', () => {
		const root = fixture({ devDependencies: { [KIT_PACKAGE_NAME]: '^1' } })

		writeFileSync(path.join(root, INDEX_HTML), INDEX_CONTENT)
		expect(project_profile.inspect_project(root).profile).toBe('basic')
	})
	it('selects full when a dependency other than kit is present', () => {
		const root = fixture({ devDependencies: { [KIT_PACKAGE_NAME]: '^1', vite: '^1' } })

		expect(project_profile.resolve_profile(root)).toEqual({
			profile: 'full',
			reason: 'package dependencies',
		})
	})
	it('selects full for a Vite project even with index.html', () => {
		const root = fixture({ devDependencies: { vite: '^1' } })

		writeFileSync(path.join(root, INDEX_HTML), INDEX_CONTENT)
		expect(project_profile.inspect_project(root).profile).toBe('full')
	})
})

// joshuafolkken/kit#2829 renamed `static` / `node` to `basic` / `full`. A project that recorded an
// old name, and a script that passes one to `--profile`, must keep resolving to the same profile.
describe('profile names before the rename', () => {
	it.each([
		['static', 'basic'],
		['node', 'full'],
	])('reads a recorded %s as %s', (recorded, expected) => {
		const root = fixture({ josh: { profile: recorded }, dependencies: { vite: '^1' } })

		expect(project_profile.resolve_profile(root)).toEqual({
			profile: expected,
			reason: 'package.json josh.profile',
		})
	})

	it.each([
		['static', 'basic'],
		['node', 'full'],
	])('accepts --profile %s as %s', (requested, expected) => {
		expect(project_profile.requested_profile(['--profile', requested])).toBe(expected)
	})

	it('spells --profile the pre-rename way for a kit that may predate it', () => {
		expect(
			project_profile.with_legacy_profile_names([NO_INSTALL, PROFILE_FLAG, 'full', 'basic']),
		).toStrictEqual([NO_INSTALL, PROFILE_FLAG, 'node', 'basic'])
		expect(project_profile.with_legacy_profile_names([PROFILE_FLAG, 'basic'])).toStrictEqual([
			PROFILE_FLAG,
			'static',
		])
	})

	it('rejects a name that was never a profile', () => {
		expect(() => project_profile.requested_profile(['--profile', 'toString'])).toThrow(
			'Profile must be basic or full',
		)
	})
})

describe('project file detection', () => {
	it('selects full for build scripts and basic for metadata only', () => {
		expect(
			project_profile.resolve_profile(fixture({ scripts: { build: 'vite build' } })).profile,
		).toBe('full')
		expect(project_profile.resolve_profile(fixture({ name: 'example' })).profile).toBe('basic')
	})
	it('detects Web and TypeScript files without index.html', () => {
		const root = fixture()

		mkdirSync(path.join(root, 'src'))
		writeFileSync(path.join(root, 'src', 'site.css'), 'body {}')
		writeFileSync(path.join(root, 'src', 'app.ts'), 'export {}')
		expect(project_profile.inspect_project(root)).toMatchObject({
			profile: 'basic',
			has_web: true,
			has_typescript: true,
			has_git: false,
			has_github: false,
		})
	})
	it('detects module JavaScript files for Web formatting', () => {
		for (const extension of ['mjs', 'cjs']) {
			const root = fixture()

			writeFileSync(path.join(root, `app.${extension}`), 'module.exports = {}')
			expect(project_profile.inspect_project(root).has_web).toBe(true)
		}
	})
})
