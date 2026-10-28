import { describe, expect, it } from 'vitest'
import { development_engines_verdict } from './development-engines-verdict'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

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
