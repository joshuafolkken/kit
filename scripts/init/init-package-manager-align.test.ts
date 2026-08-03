import { build_package_manager_manifest } from '#scripts/version/package-manager-manifest-fixture'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { describe, expect, it } from 'vitest'
import { init } from './init'

interface PackageJson {
	packageManager: string
	devEngines: { packageManager: { version: string } }
}

// The whole pin, integrity suffix included — the only form pnpm accepts as an
// exact match against `packageManager`.
const PINNED_VERSION = '11.4.0+sha512.abc'

// A consumer manifest that already pins packageManager but carries a drifted
// (range) devEngines version, mirroring a project scaffolded before the
// exact-match policy. `apply_package_json_merges` must leave the consumer's own
// packageManager intact and realign devEngines to it.
const CONSUMER_WITH_DRIFT = build_package_manager_manifest(`pnpm@${PINNED_VERSION}`, '>=11.0.0-0')

describe('init.apply_package_json_merges devEngines alignment', () => {
	it('aligns devEngines.packageManager.version with the consumer packageManager pin', () => {
		const result = init.apply_package_json_merges(CONSUMER_WITH_DRIFT)
		const parsed = JSON.parse(result) as PackageJson
		const pin = package_manager_version.extract_pnpm_pin(parsed.packageManager)

		expect(pin).toBe(PINNED_VERSION)
		expect(parsed.devEngines.packageManager.version).toBe(PINNED_VERSION)
	})
})
