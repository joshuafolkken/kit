import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { file_content } from '#scripts/sync/file-content'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execaSync } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { init_bootstrap } from './init-bootstrap'

vi.mock('execa', () => ({ execaSync: vi.fn() }))

const mocked_execa = vi.mocked(execaSync)
const KIT_DIR = fileURLToPath(new URL('../../', import.meta.url))
const KIT_ADD = 'pnpm add -D --allow-build=esbuild --allow-build=unrs-resolver @joshuafolkken/kit'
// The project's kit may predate joshuafolkken/kit#2829, so the hand-off spells the profile the way
// every kit reads it.
const HANDOFF = 'pnpm exec josh init --profile static'
const PROFILE_ARGS = ['--profile', 'basic']
const PACKAGE_JSON = 'package.json'
const WORKSPACE = 'pnpm-workspace.yaml'
const TEMPLATE_RELEASE_AGE = 'minimumReleaseAge: 4320'
const OWN_RELEASE_AGE = 'minimumReleaseAge: 10080'
const fixture = { root: '' }
const make_directory = temporary_directory()

function result(exit_code: number): ReturnType<typeof execaSync> {
	const value: unknown = { exitCode: exit_code }

	return value as ReturnType<typeof execaSync>
}

function commands(): Array<string> {
	return mocked_execa.mock.calls.map((call) => {
		const args: ReadonlyArray<unknown> = Array.isArray(call[1]) ? call[1] : []

		return [call[0], ...args].join(' ')
	})
}

function call_options(index: number): unknown {
	// The mock is typed from execa's two-argument overload, so the options argument is read untyped.
	const { calls }: { calls: ReadonlyArray<ReadonlyArray<unknown>> } = mocked_execa.mock

	return calls[index]?.[2]
}

function link_project_kit(target: string): void {
	const scope = path.join(fixture.root, 'node_modules', '@joshuafolkken')

	mkdirSync(scope, { recursive: true })
	symlinkSync(target, path.join(scope, 'kit'))
}

function read_manifest(directory: string): string {
	return readFileSync(path.join(directory, PACKAGE_JSON), 'utf8')
}

function read_workspace(): string {
	return readFileSync(path.join(fixture.root, WORKSPACE), 'utf8')
}

// Records, at each command the hand-off runs, whether the project already had its own package.json.
function record_manifest_presence(project: string): Array<boolean> {
	const presence: Array<boolean> = []

	mocked_execa.mockImplementation(() => {
		presence.push(existsSync(path.join(project, PACKAGE_JSON)))

		return result(0)
	})

	return presence
}

beforeEach(() => {
	fixture.root = make_directory('josh-init-bootstrap-')
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(result(0))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('is_project_kit', () => {
	it('is false when the project has no kit installed', () => {
		expect(init_bootstrap.is_project_kit(KIT_DIR, fixture.root)).toBe(false)
	})

	it('is true when the running kit is the one the project installed, reached through a symlink', () => {
		link_project_kit(KIT_DIR)

		expect(init_bootstrap.is_project_kit(KIT_DIR, fixture.root)).toBe(true)
	})

	it('is false when the project installed a different kit', () => {
		const other = path.join(fixture.root, 'other-kit')

		mkdirSync(other)
		link_project_kit(other)

		expect(init_bootstrap.is_project_kit(KIT_DIR, fixture.root)).toBe(false)
	})
})

describe('kit_build_flags', () => {
	it('approves every build the template allows and none it denies', () => {
		const template = "allowBuilds:\n  esbuild: true\n  '@scope/tool': false\n  other: true\n"

		expect(init_bootstrap.kit_build_flags(template)).toStrictEqual([
			'--allow-build=esbuild',
			'--allow-build=other',
		])
	})
})

describe('hand_off', () => {
	it('adds kit with the build approvals, then runs its josh init with the same arguments', () => {
		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toBeUndefined()
		expect(commands()).toStrictEqual([KIT_ADD, HANDOFF])
	})

	it('keeps the version a project already lists by installing instead of adding', () => {
		const manifest = '{ "devDependencies": { "@joshuafolkken/kit": "1.900.0" } }'

		writeFileSync(path.join(fixture.root, PACKAGE_JSON), manifest)

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toBeUndefined()
		expect(commands()).toStrictEqual(['pnpm install', HANDOFF])
	})

	it('adds kit when the existing package.json does not list it', () => {
		writeFileSync(path.join(fixture.root, PACKAGE_JSON), JSON.stringify({ private: true }))
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(commands()[0]).toBe(KIT_ADD)
	})

	it('stops before handing off when the install fails', () => {
		mocked_execa.mockReturnValueOnce(result(1))

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toMatch(
			new RegExp(`^${KIT_ADD} failed`, 'u'),
		)
		expect(commands()).toStrictEqual([KIT_ADD])
	})

	it('reports a failure of the project kit’s own init', () => {
		mocked_execa.mockReturnValueOnce(result(0)).mockReturnValueOnce(result(1))

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toContain('failed')
	})
})

describe('hand_off — a directory without package.json', () => {
	it('creates package.json in the project before adding kit, leaving an ancestor project untouched', () => {
		const ancestor_manifest = '{ "devDependencies": { "@joshuafolkken/kit": "0.281.0" } }'
		const project = path.join(fixture.root, 'project')

		mkdirSync(project)
		writeFileSync(path.join(fixture.root, PACKAGE_JSON), ancestor_manifest)
		const manifest_presence = record_manifest_presence(project)

		init_bootstrap.hand_off(KIT_DIR, project, PROFILE_ARGS)

		expect(manifest_presence).toStrictEqual([true, true])
		expect(call_options(0)).toMatchObject({ cwd: project })
		expect(JSON.parse(read_manifest(project))).toStrictEqual({ private: true })
		expect(read_manifest(fixture.root)).toBe(ancestor_manifest)
	})

	it('writes the new package.json through the contained write', () => {
		const write_contained = vi.spyOn(file_content, 'write_contained')

		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(write_contained).toHaveBeenCalledWith(
			path.join(fixture.root, PACKAGE_JSON),
			expect.any(String),
		)
	})

	it('leaves an existing package.json as it is', () => {
		const manifest = '{ "name": "existing" }'

		writeFileSync(path.join(fixture.root, PACKAGE_JSON), manifest)
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(read_manifest(fixture.root)).toBe(manifest)
	})
})

// Records, at each command the hand-off runs, the project's pnpm-workspace.yaml as it stood then.
function record_workspace(project: string): Array<string> {
	const contents: Array<string> = []
	const file = path.join(project, WORKSPACE)

	mocked_execa.mockImplementation(() => {
		contents.push(existsSync(file) ? readFileSync(file, 'utf8') : '')

		return result(0)
	})

	return contents
}

describe('hand_off — the release-age wait before the first install', () => {
	it('writes the template’s minimumReleaseAge into a new project before adding kit', () => {
		const workspace = record_workspace(fixture.root)

		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(commands()[0]).toBe(KIT_ADD)
		expect(workspace[0]).toContain(TEMPLATE_RELEASE_AGE)
	})

	it('appends the wait to an existing pnpm-workspace.yaml, keeping its own lines', () => {
		const own_lines = 'packages:\n  - app\n'

		writeFileSync(path.join(fixture.root, WORKSPACE), own_lines)
		const workspace = record_workspace(fixture.root)

		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(workspace[0]).toContain(own_lines)
		expect(workspace[0]).toContain(TEMPLATE_RELEASE_AGE)
	})

	it('keeps the wait a project already set in pnpm-workspace.yaml', () => {
		writeFileSync(path.join(fixture.root, WORKSPACE), `${OWN_RELEASE_AGE}\n`)
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(read_workspace()).toBe(`${OWN_RELEASE_AGE}\n`)
	})

	it('carries the wait a project set in .npmrc', () => {
		writeFileSync(path.join(fixture.root, '.npmrc'), 'minimum-release-age=10080\n')
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(read_workspace()).toContain(OWN_RELEASE_AGE)
	})

	it('names the too-new dependency and the lockfile regeneration when the install fails', () => {
		mocked_execa.mockReturnValueOnce(result(1))

		const failure = init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(failure).toContain('minimumReleaseAge')
		expect(failure).toContain('pnpm-lock.yaml')
	})
})

describe('hand_off — a repeated hand-off', () => {
	it('marks the handed-off run so it can tell it was handed off', () => {
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		expect(call_options(1)).toMatchObject({ env: { JOSH_INIT_HANDED_OFF: '1' } })
	})

	it('refuses to hand off again from a run that was itself handed off', () => {
		vi.stubEnv('JOSH_INIT_HANDED_OFF', '1')

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toContain('not at')
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})
