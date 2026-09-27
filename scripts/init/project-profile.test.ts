import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { project_profile } from './project-profile'

const roots: Array<string> = []

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
		const root = fixture({ josh: { profile: 'node' } })

		expect(project_profile.resolve_profile(root, 'static')).toEqual({
			profile: 'static',
			reason: 'explicit --profile',
		})
	})
	it('keeps the recorded profile after dependencies appear', () => {
		const root = fixture({ josh: { profile: 'static' }, dependencies: { vite: '^1' } })

		expect(project_profile.resolve_profile(root).profile).toBe('static')
	})
	it('selects static without a package manifest', () => {
		expect(project_profile.resolve_profile(fixture()).profile).toBe('static')
	})
	it('selects node for a Vite project even with index.html', () => {
		const root = fixture({ devDependencies: { vite: '^1' } })

		writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>')
		expect(project_profile.inspect_project(root).profile).toBe('node')
	})
})

describe('project file detection', () => {
	it('selects node for build scripts and static for metadata only', () => {
		expect(
			project_profile.resolve_profile(fixture({ scripts: { build: 'vite build' } })).profile,
		).toBe('node')
		expect(project_profile.resolve_profile(fixture({ name: 'example' })).profile).toBe('static')
	})
	it('detects Web and TypeScript files without index.html', () => {
		const root = fixture()

		mkdirSync(path.join(root, 'src'))
		writeFileSync(path.join(root, 'src', 'site.css'), 'body {}')
		writeFileSync(path.join(root, 'src', 'app.ts'), 'export {}')
		expect(project_profile.inspect_project(root)).toMatchObject({
			profile: 'static',
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
