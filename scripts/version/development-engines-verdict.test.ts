import { readFileSync } from 'node:fs'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { describe, expect, it, vi } from 'vitest'
import { development_engines_verdict } from './development-engines-verdict'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }))
vi.mock('#scripts/git/git-spawn-sync', () => ({ git_spawn_sync: { read: vi.fn() } }))

const OLD_PIN = 'pnpm@11.5.0+sha512.abc'
const NEW_PIN = 'pnpm@11.6.0+sha512.def'
const OLD_VERSION = '11.5.0+sha512.abc'
const NEW_VERSION = '11.6.0+sha512.def'
const NEW_BARE_VERSION = '11.6.0'
const BEFORE = build_package_manager_manifest(OLD_PIN, OLD_VERSION)
const ON_FAIL_ERROR = '"onFail": "error"'
const KEPT = 'devEngines: kept'
const UNCHANGED = 'devEngines: unchanged'

const { judge } = development_engines_verdict

describe('development_engines_verdict.judge — unchanged and kept', () => {
	it('answers unchanged when devEngines is identical, whatever else moved', () => {
		expect(judge(BEFORE, build_package_manager_manifest(NEW_PIN, OLD_VERSION))).toBe(UNCHANGED)
	})

	it('keeps a version byte-identical to the new packageManager pin', () => {
		expect(judge(BEFORE, build_package_manager_manifest(NEW_PIN, NEW_VERSION))).toBe(KEPT)
	})

	it('keeps josh sync moving onFail from error to download', () => {
		const after = BEFORE.replace(ON_FAIL_ERROR, '"onFail": "download"')

		expect(judge(BEFORE, after)).toBe(KEPT)
	})
})

describe('development_engines_verdict.describe', () => {
	it('answers not judged when HEAD has no manifest to compare against', () => {
		expect(development_engines_verdict.describe(undefined, BEFORE)).toBe(
			'devEngines: not judged (no package.json at HEAD to compare against)',
		)
	})

	it('judges the two manifests when HEAD has one', () => {
		expect(development_engines_verdict.describe(BEFORE, BEFORE)).toBe(UNCHANGED)
	})
})

describe('development_engines_verdict.judge — restore', () => {
	it('restores a version that dropped the integrity suffix', () => {
		expect(judge(BEFORE, build_package_manager_manifest(NEW_PIN, NEW_BARE_VERSION))).toBe(
			'devEngines: restore (integrity suffix missing)',
		)
	})

	it('restores a version that does not match the packageManager pin', () => {
		expect(judge(BEFORE, build_package_manager_manifest(OLD_PIN, NEW_VERSION))).toBe(
			`devEngines: restore (version ${NEW_VERSION} is not the packageManager pin ${OLD_VERSION})`,
		)
	})

	it('restores a changed name', () => {
		const after = BEFORE.replace('"name": "pnpm"', '"name": "yarn"')

		expect(judge(BEFORE, after)).toBe(
			'devEngines: restore (structure changed: packageManager.name)',
		)
	})

	it('restores an onFail moved anywhere but from error to download', () => {
		const after = BEFORE.replace(ON_FAIL_ERROR, '"onFail": "ignore"')

		expect(judge(BEFORE, after)).toBe(
			'devEngines: restore (structure changed: packageManager.onFail)',
		)
	})

	it('restores a field added to devEngines', () => {
		const after = BEFORE.replace('"devEngines": {', '"devEngines": {"runtime": {"name": "node"},')

		expect(judge(BEFORE, after)).toBe('devEngines: restore (structure changed: runtime)')
	})

	it('restores a version removed from devEngines.packageManager', () => {
		const after = BEFORE.replace(`"version": "${OLD_VERSION}",`, '')

		expect(judge(BEFORE, after)).toBe(
			'devEngines: restore (structure changed: packageManager.version)',
		)
	})
})

describe('development_engines_verdict.judge — restore with nothing to compare inside', () => {
	it.each([
		['no packageManager field', undefined],
		['a non-pnpm packageManager', 'yarn@4.0.0'],
	])('restores a moved version when there is %s to match', (_label, package_manager) => {
		const before = build_package_manager_manifest(package_manager, OLD_VERSION)
		const after = build_package_manager_manifest(package_manager, NEW_VERSION)

		expect(judge(before, after)).toBe('devEngines: restore (no pnpm@ packageManager pin to match)')
	})

	it('restores devEngines.packageManager turned into the npm array form', () => {
		const after = JSON.stringify({ packageManager: NEW_PIN, devEngines: { packageManager: [] } })

		expect(judge(BEFORE, after)).toMatch(
			/^devEngines: restore \(structure changed: packageManager, /u,
		)
	})
})

describe('development_engines_verdict.report', () => {
	it('prints the verdict of HEAD against the working tree', () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		vi.mocked(git_spawn_sync.read).mockReturnValue(BEFORE)
		vi.mocked(readFileSync).mockReturnValue(build_package_manager_manifest(NEW_PIN, NEW_VERSION))
		development_engines_verdict.report()

		expect(git_spawn_sync.read).toHaveBeenCalledWith(['show', 'HEAD:./package.json'])
		expect(info).toHaveBeenCalledWith(KEPT)
		info.mockRestore()
	})
})

describe('development_engines_verdict.describe — an unreadable manifest', () => {
	it('answers not judged instead of throwing', () => {
		expect(development_engines_verdict.describe(BEFORE, '{')).toMatch(
			/^devEngines: not judged \(package\.json unreadable: /u,
		)
	})
})
