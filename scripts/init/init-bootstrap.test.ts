import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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
const fixture = { root: '' }

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

function link_project_kit(target: string): void {
	const scope = path.join(fixture.root, 'node_modules', '@joshuafolkken')

	mkdirSync(scope, { recursive: true })
	symlinkSync(target, path.join(scope, 'kit'))
}

beforeEach(() => {
	fixture.root = mkdtempSync(path.join(os.tmpdir(), 'josh-init-bootstrap-'))
	mocked_execa.mockReset()
	mocked_execa.mockReturnValue(result(0))
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(fixture.root, { recursive: true, force: true })
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

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toBe(`${KIT_ADD} failed`)
		expect(commands()).toStrictEqual([KIT_ADD])
	})

	it('reports a failure of the project kit’s own init', () => {
		mocked_execa.mockReturnValueOnce(result(0)).mockReturnValueOnce(result(1))

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toContain('failed')
	})
})

describe('hand_off — a repeated hand-off', () => {
	it('marks the handed-off run so it can tell it was handed off', () => {
		init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)

		// The mock is typed from execa's two-argument overload, so the options argument is read untyped.
		const { calls }: { calls: ReadonlyArray<ReadonlyArray<unknown>> } = mocked_execa.mock

		expect(calls[1]?.[2]).toMatchObject({ env: { JOSH_INIT_HANDED_OFF: '1' } })
	})

	it('refuses to hand off again from a run that was itself handed off', () => {
		vi.stubEnv('JOSH_INIT_HANDED_OFF', '1')

		expect(init_bootstrap.hand_off(KIT_DIR, fixture.root, PROFILE_ARGS)).toContain('not at')
		expect(mocked_execa).not.toHaveBeenCalled()
	})
})
