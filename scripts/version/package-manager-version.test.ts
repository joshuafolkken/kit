import { describe, expect, it } from 'vitest'
import { package_manager_version } from './package-manager-version'

const PM_PIN = 'pnpm@11.5.0+sha512.abc'
const PM_PRERELEASE_PIN = 'pnpm@11.6.0-rc.1+sha512.def'
const RANGE_VERSION = '>=11.0.0-0'
const EXACT_VERSION = '11.5.0'
const PRERELEASE_VERSION = '11.6.0-rc.1'

function build_manifest(
	package_manager: string | undefined,
	development_engines_version: string,
): string {
	const package_manager_line =
		package_manager === undefined ? '' : `\t"packageManager": "${package_manager}",\n`

	return `{\n\t"name": "demo",\n${package_manager_line}\t"devEngines": {\n\t\t"packageManager": {\n\t\t\t"name": "pnpm",\n\t\t\t"version": "${development_engines_version}",\n\t\t\t"onFail": "error"\n\t\t}\n\t}\n}\n`
}

const align = package_manager_version.align_development_engines_version

describe('package_manager_version.extract_pnpm_version', () => {
	it('extracts the version from a hash-suffixed pin', () => {
		expect(package_manager_version.extract_pnpm_version(PM_PIN)).toBe(EXACT_VERSION)
	})

	it('preserves a prerelease identifier rather than truncating it', () => {
		expect(package_manager_version.extract_pnpm_version(PM_PRERELEASE_PIN)).toBe(PRERELEASE_VERSION)
	})

	it('extracts the version from a bare pin without a hash', () => {
		expect(package_manager_version.extract_pnpm_version('pnpm@11.5.0')).toBe(EXACT_VERSION)
	})

	it('returns undefined for a non-pnpm package manager', () => {
		expect(package_manager_version.extract_pnpm_version('yarn@4.0.0')).toBeUndefined()
	})

	it('returns undefined for an empty value', () => {
		expect(package_manager_version.extract_pnpm_version('')).toBeUndefined()
	})
})

describe('package_manager_version.align_development_engines_version — rewrites', () => {
	it('rewrites a drifted devEngines version to match the packageManager pin', () => {
		expect(align(build_manifest(PM_PIN, RANGE_VERSION))).toBe(build_manifest(PM_PIN, EXACT_VERSION))
	})

	it('aligns to a prerelease version faithfully', () => {
		expect(align(build_manifest(PM_PRERELEASE_PIN, EXACT_VERSION))).toBe(
			build_manifest(PM_PRERELEASE_PIN, PRERELEASE_VERSION),
		)
	})

	it('aligns when devEngines lists version before name', () => {
		const version_first = `{\n\t"packageManager": "${PM_PIN}",\n\t"devEngines": { "packageManager": { "version": "${RANGE_VERSION}", "name": "pnpm" } }\n}\n`
		const expected = `{\n\t"packageManager": "${PM_PIN}",\n\t"devEngines": { "packageManager": { "version": "${EXACT_VERSION}", "name": "pnpm" } }\n}\n`

		expect(align(version_first)).toBe(expected)
	})
})

describe('package_manager_version.align_development_engines_version — no-ops', () => {
	it('leaves the content untouched when the versions already match', () => {
		const matched = build_manifest(PM_PIN, EXACT_VERSION)

		expect(align(matched)).toBe(matched)
	})

	it('leaves the content untouched when packageManager is absent', () => {
		const without_pm = build_manifest(undefined, RANGE_VERSION)

		expect(align(without_pm)).toBe(without_pm)
	})

	it('leaves the content untouched when devEngines.packageManager is absent', () => {
		const without_development_engines = `{\n\t"name": "demo",\n\t"packageManager": "${PM_PIN}"\n}\n`

		expect(align(without_development_engines)).toBe(without_development_engines)
	})
})
