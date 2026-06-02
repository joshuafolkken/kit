import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
// Capture the full version (including any prerelease identifier) up to the
// optional `+<hash>` suffix, so prerelease pins like `pnpm@11.6.0-rc.1+...` are
// compared faithfully rather than truncated to `11.6.0`.
const PNPM_VERSION_REGEX = /^pnpm@([^+]+)/u

interface PackageJson {
	packageManager: string
	devEngines: { packageManager: { version: string } }
}

const PACKAGE_JSON = JSON.parse(
	readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
) as PackageJson

// Guards the invariant required by pnpm 11.5.0 (pnpm/pnpm#11307): when both
// `packageManager` and `devEngines.packageManager` are present, pnpm only
// suppresses the "Cannot use both ..." warning if their versions match exactly.
// If a future bump drifts one field, this fails before the warning reappears.
describe('package.json packageManager / devEngines version consistency', () => {
	it('pins devEngines.packageManager.version to the exact packageManager version', () => {
		const package_manager_version = PNPM_VERSION_REGEX.exec(PACKAGE_JSON.packageManager)?.[1]

		expect(package_manager_version).toBeDefined()
		expect(PACKAGE_JSON.devEngines.packageManager.version).toBe(package_manager_version)
	})
})
