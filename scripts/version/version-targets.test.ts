import { execaSync } from 'execa'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { version_targets } from './version-targets'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa_sync = vi.mocked(execaSync)

type ExecaSyncResult = ReturnType<typeof execaSync>

const KIT = '@joshuafolkken/kit'
const GLOBAL_VERSION = '0.243.0'

function fake_stdout(stdout: string): ExecaSyncResult {
	const result = { stdout }

	return result as unknown as ExecaSyncResult
}

function global_ls_json(version: string): string {
	return JSON.stringify([{ path: '/g', dependencies: { [KIT]: { from: KIT, version } } }])
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_targets.parse_global_version', () => {
	it('extracts the matched dependency version', () => {
		expect(version_targets.parse_global_version(global_ls_json(GLOBAL_VERSION))).toBe(
			GLOBAL_VERSION,
		)
	})

	it('returns undefined when the package is absent from dependencies', () => {
		const stdout = JSON.stringify([{ path: '/g', dependencies: {} }])

		expect(version_targets.parse_global_version(stdout)).toBeUndefined()
	})

	it('returns undefined for an empty array', () => {
		expect(version_targets.parse_global_version('[]')).toBeUndefined()
	})

	it('returns undefined for invalid JSON', () => {
		expect(version_targets.parse_global_version('')).toBeUndefined()
		expect(version_targets.parse_global_version('not json')).toBeUndefined()
	})
})

describe('version_targets.parse_project_version', () => {
	it('extracts the version from a package.json string', () => {
		expect(version_targets.parse_project_version(JSON.stringify({ version: '0.241.0' }))).toBe(
			'0.241.0',
		)
	})

	it('returns undefined when raw is undefined (file missing)', () => {
		expect(version_targets.parse_project_version(undefined)).toBeUndefined()
	})

	it('returns undefined for malformed package.json', () => {
		expect(version_targets.parse_project_version('{ broken')).toBeUndefined()
		expect(version_targets.parse_project_version('{}')).toBeUndefined()
	})
})

describe('version_targets.read_global_version', () => {
	it('queries pnpm ls -g and parses the version', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout(global_ls_json(GLOBAL_VERSION)))

		expect(version_targets.read_global_version()).toBe(GLOBAL_VERSION)
		expect(mocked_execa_sync).toHaveBeenCalledWith('pnpm', ['ls', '-g', '--json', KIT], {
			reject: false,
		})
	})

	it('returns undefined when pnpm produces no parsable output', () => {
		mocked_execa_sync.mockReturnValue(fake_stdout(''))

		expect(version_targets.read_global_version()).toBeUndefined()
	})
})

describe('version_targets.project_package_path', () => {
	it('points at the kit package.json under cwd node_modules', () => {
		expect(version_targets.project_package_path('/project')).toBe(
			`/project/node_modules/${KIT}/package.json`,
		)
	})
})
