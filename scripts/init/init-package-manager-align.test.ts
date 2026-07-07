import { package_manager_version } from '#scripts/version/package-manager-version'
import { describe, expect, it } from 'vitest'
import { init } from './init'

interface PackageJson {
	packageManager: string
	devEngines: { packageManager: { version: string } }
}

// A consumer manifest that already pins packageManager but carries a drifted
// (range) devEngines version, mirroring a project scaffolded before the
// exact-match policy. `apply_package_json_merges` must leave the consumer's own
// packageManager intact and realign devEngines to it.
const CONSUMER_WITH_DRIFT =
	`{\n\t"name": "demo",\n\t"packageManager": "pnpm@11.4.0+sha512.abc",\n` +
	`\t"devEngines": {\n\t\t"packageManager": {\n\t\t\t"name": "pnpm",\n` +
	`\t\t\t"version": ">=11.0.0-0",\n\t\t\t"onFail": "error"\n\t\t}\n\t}\n}\n`

describe('init.apply_package_json_merges devEngines alignment', () => {
	it('aligns devEngines.packageManager.version with the consumer packageManager pin', () => {
		const result = init.apply_package_json_merges(CONSUMER_WITH_DRIFT)
		const parsed = JSON.parse(result) as PackageJson
		const pin = package_manager_version.extract_pnpm_version(parsed.packageManager)

		expect(pin).toBe('11.4.0')
		expect(parsed.devEngines.packageManager.version).toBe('11.4.0')
	})
})
