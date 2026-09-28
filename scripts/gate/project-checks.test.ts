import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { project_checks } from './project-checks'

const roots: Array<string> = []
const NODE_MODULES = 'node_modules'
const PACKAGE_JSON = 'package.json'
const STATIC_MANIFEST = '{"josh":{"profile":"static"}}'

function fixture(): string {
	const root = mkdtempSync(path.join(tmpdir(), 'josh-project-checks-'))

	roots.push(root)

	return root
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('project_checks profile and files', () => {
	it('uses only a recorded static profile', () => {
		const root = fixture()

		expect(project_checks.is_static(root)).toBe(false)
		writeFileSync(path.join(root, PACKAGE_JSON), STATIC_MANIFEST)
		expect(project_checks.is_static(root)).toBe(true)
		mkdirSync(path.join(root, 'src'))
		expect(project_checks.is_static(path.join(root, 'src'))).toBe(true)
	})

	it('ignores dependency files when looking for web files', () => {
		const root = fixture()

		mkdirSync(path.join(root, NODE_MODULES))
		writeFileSync(path.join(root, NODE_MODULES, 'other.js'), '')
		mkdirSync(path.join(root, '.venv'))
		writeFileSync(path.join(root, '.venv', 'other.js'), '')
		expect(project_checks.has_files(root, project_checks.WEB_FILES)).toBe(false)
	})

	it('finds web files added later from a subdirectory', () => {
		const root = fixture()

		writeFileSync(path.join(root, 'index.html'), '')
		expect(project_checks.has_files(root, project_checks.WEB_FILES)).toBe(true)
		writeFileSync(path.join(root, PACKAGE_JSON), STATIC_MANIFEST)
		mkdirSync(path.join(root, 'src'))
		expect(project_checks.has_files(path.join(root, 'src'), project_checks.WEB_FILES)).toBe(true)
	})

	it('does not count TypeScript in node_modules', () => {
		const root = fixture()

		mkdirSync(path.join(root, NODE_MODULES))
		writeFileSync(path.join(root, NODE_MODULES, 'other.ts'), '')
		expect(project_checks.has_files(root, project_checks.TYPE_FILES)).toBe(false)
	})
})

describe('project_checks type-check readiness', () => {
	it('skips absent TypeScript and enables the check after files and tools arrive', () => {
		const root = fixture()

		writeFileSync(path.join(root, PACKAGE_JSON), STATIC_MANIFEST)
		expect(project_checks.type_check_skip_reason(root)).toContain('no TypeScript files')
		writeFileSync(path.join(root, 'app.ts'), '')
		expect(project_checks.type_check_skip_reason(root)).toContain('no TypeScript configuration')
		writeFileSync(path.join(root, 'tsconfig.json'), '{}')
		expect(project_checks.type_check_skip_reason(root)).toContain('typescript is not installed')
		mkdirSync(path.join(root, NODE_MODULES, '.bin'), { recursive: true })
		writeFileSync(path.join(root, NODE_MODULES, '.bin', 'tsc'), '')
		expect(project_checks.type_check_skip_reason(root)).toBeUndefined()
	})
})

describe('project_checks eslint readiness', () => {
	it('skips absent ESLint on a static project and enables it once files and tools arrive', () => {
		const root = fixture()

		writeFileSync(path.join(root, PACKAGE_JSON), STATIC_MANIFEST)
		expect(project_checks.eslint_skip_reason(root)).toContain('no JavaScript or TypeScript')
		writeFileSync(path.join(root, 'site.js'), '')
		expect(project_checks.eslint_skip_reason(root)).toContain('no ESLint configuration')
		writeFileSync(path.join(root, 'eslint.config.js'), '')
		expect(project_checks.eslint_skip_reason(root)).toContain('eslint is not installed')
		mkdirSync(path.join(root, NODE_MODULES, '.bin'), { recursive: true })
		writeFileSync(path.join(root, NODE_MODULES, '.bin', 'eslint'), '')
		expect(project_checks.eslint_skip_reason(root)).toBeUndefined()
	})

	it('never skips ESLint on a node project', () => {
		expect(project_checks.eslint_skip_reason(fixture())).toBeUndefined()
	})
})

describe('project_checks optional configuration', () => {
	it('finds later ESLint and cspell configuration from a subdirectory', () => {
		const root = fixture()

		writeFileSync(path.join(root, PACKAGE_JSON), STATIC_MANIFEST)
		mkdirSync(path.join(root, 'src'))
		const nested = path.join(root, 'src')

		expect(project_checks.has_config(nested, project_checks.ESLINT_CONFIGS)).toBe(false)
		writeFileSync(path.join(root, 'eslint.config.ts'), '')
		writeFileSync(path.join(root, 'cspell.config.json'), '{}')
		expect(project_checks.has_config(nested, project_checks.ESLINT_CONFIGS)).toBe(true)
		expect(project_checks.has_config(nested, project_checks.CSPELL_CONFIGS)).toBe(true)
	})
})
