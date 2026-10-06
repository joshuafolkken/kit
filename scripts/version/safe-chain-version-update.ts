import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { COMMAND_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { ci_installer_pin } from '#scripts/safe-chain/ci-installer-pin'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { npm_registry } from '#scripts/version/npm-registry'
import { execaSync } from 'execa'
import { z } from 'zod'

const SAFE_CHAIN_PKG = '@aikidosec/safe-chain'

const manifest_schema = z.object({ name: z.string().optional() })

// The registry's answer is trusted only as an exact semver version: it ends up in workflow files and
// in the installer URL (joshuafolkken/kit#3266).
function fetch_latest_version(): string | undefined {
	const result = execaSync('npm', ['view', SAFE_CHAIN_PKG, 'version'], {
		reject: false,
		timeout: COMMAND_TIMEOUT_MS,
	})
	if (result.exitCode !== 0 || !result.stdout) return undefined

	return npm_registry.valid_version(result.stdout.trim())
}

// The workflows carrying the pin are kit-distributed, so only kit advances it: a consumer bumping its
// copy would be put back to kit's pin by the next `josh sync` (joshuafolkken/kit#3269).
function is_kit_source(package_json_path: string): boolean {
	const manifest = manifest_schema.safeParse(
		json_value.parse_or_undefined(file_reader.read_if_readable(package_json_path) ?? ''),
	)

	return manifest.success && manifest.data.name === KIT_PACKAGE_NAME
}

// The hash-verified installer pinned in the workflows is the one place a safe-chain release is
// recorded; `preinstall` no longer names one (joshuafolkken/kit#3269).
function sync(package_json_path: string): void {
	if (!is_kit_source(package_json_path)) return

	const latest = fetch_latest_version()

	if (latest === undefined) {
		console.warn(`\n⚠ Could not fetch a valid latest version of ${SAFE_CHAIN_PKG}; skipping`)

		return
	}

	ci_installer_pin.sync(latest)
}

const safe_chain_version_update = {
	sync,
	fetch_latest_version,
}

export { safe_chain_version_update }
