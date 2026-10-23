import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PACKAGE_JSON } from '#scripts/lib/package-manifest'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { version_targets } from './version-targets'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const KIT = '@joshuafolkken/kit'
const GLOBAL_VERSION = '0.243.0'
const PROJECT_VERSION = '0.246.0'

function fake_stdout(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

function global_ls_json(version: string): string {
	return JSON.stringify([{ path: '/g', dependencies: { [KIT]: { from: KIT, version } } }])
}

const ctx = { work_directory: '' }

function write_manifest(content: string): void {
	writeFileSync(path.join(ctx.work_directory, PACKAGE_JSON), content)
}

beforeEach(() => {
	vi.clearAllMocks()
	ctx.work_directory = mkdtempSync(path.join(tmpdir(), 'kit-workspace-'))
})

afterEach(() => {
	rmSync(ctx.work_directory, { recursive: true, force: true })
})

describe('version_targets.parse_global_version', () => {
	it('extracts the matched dependency version', () => {
		expect(version_targets.parse_global_version(global_ls_json(GLOBAL_VERSION), KIT)).toBe(
			GLOBAL_VERSION,
		)
	})

	it('returns undefined when the package is absent from dependencies', () => {
		const stdout = JSON.stringify([{ path: '/g', dependencies: {} }])

		expect(version_targets.parse_global_version(stdout, KIT)).toBeUndefined()
	})

	it('returns undefined when a different package name is queried', () => {
		expect(
			version_targets.parse_global_version(global_ls_json(GLOBAL_VERSION), '@joshuafolkken/other'),
		).toBeUndefined()
	})

	it('returns undefined for an empty array', () => {
		expect(version_targets.parse_global_version('[]', KIT)).toBeUndefined()
	})

	it('returns undefined for invalid JSON', () => {
		expect(version_targets.parse_global_version('', KIT)).toBeUndefined()
		expect(version_targets.parse_global_version('not json', KIT)).toBeUndefined()
	})
})

describe('version_targets.build_pnpm_ls_arguments', () => {
	it('builds the global ls query for the given package name', () => {
		expect(version_targets.build_pnpm_ls_arguments(KIT)).toStrictEqual(['ls', '-g', '--json', KIT])
	})
})

function write_installed_manifest(content: string): void {
	const package_directory = path.join(ctx.work_directory, 'node_modules', KIT)

	mkdirSync(package_directory, { recursive: true })
	writeFileSync(path.join(package_directory, PACKAGE_JSON), content)
}

describe('version_targets.read_project_version', () => {
	it('reads the version from <cwd>/node_modules/<package>/package.json', () => {
		write_manifest(JSON.stringify({ version: GLOBAL_VERSION }))
		write_installed_manifest(JSON.stringify({ version: PROJECT_VERSION }))

		expect(version_targets.read_project_version(ctx.work_directory, KIT)).toBe(PROJECT_VERSION)
	})

	it('returns undefined when the package is not installed', () => {
		expect(version_targets.read_project_version(ctx.work_directory, KIT)).toBeUndefined()
	})

	it('returns undefined when the installed manifest is malformed', () => {
		write_installed_manifest('{ broken')

		expect(version_targets.read_project_version(ctx.work_directory, KIT)).toBeUndefined()
	})
})

describe('version_targets.read_global_version', () => {
	it('queries pnpm ls -g and parses the version', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout(global_ls_json(GLOBAL_VERSION)))

		expect(version_targets.read_global_version(KIT)).toBe(GLOBAL_VERSION)
		expect(mocked_execa_sync).toHaveBeenCalledWith('pnpm', ['ls', '-g', '--json', KIT], {
			reject: false,
		})
	})

	it('returns undefined when pnpm produces no parsable output', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout(''))

		expect(version_targets.read_global_version(KIT)).toBeUndefined()
	})
})

describe('version_targets.read_workspace_version', () => {
	it('reads the version from <cwd>/package.json', () => {
		write_manifest(JSON.stringify({ version: PROJECT_VERSION }))

		expect(version_targets.read_workspace_version(ctx.work_directory)).toBe(PROJECT_VERSION)
	})

	it('returns undefined when package.json is missing', () => {
		expect(version_targets.read_workspace_version(ctx.work_directory)).toBeUndefined()
	})

	it('returns undefined when the workspace manifest is malformed', () => {
		write_manifest('{ broken')

		expect(version_targets.read_workspace_version(ctx.work_directory)).toBeUndefined()
	})
})

// The `📦 project version: <v>` formatters this module carried were removed with the child's version
// bump (joshuafolkken/kit#1486). Asserted as an absence, because the reading they encoded — the local
// manifest names what this run ships — is the one that has to stay gone.
describe('version_targets — the project version line is gone', () => {
	it('no longer exposes either formatter', () => {
		expect(Object.keys(version_targets)).not.toContain('format_project_version_line')
		expect(Object.keys(version_targets)).not.toContain('project_version_line')
	})
})
