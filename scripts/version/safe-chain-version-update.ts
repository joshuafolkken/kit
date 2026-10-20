import { ci_installer_pin } from '#scripts/safe-chain/ci-installer-pin'
import { npm_registry } from '#scripts/version/npm-registry'

const SAFE_CHAIN_PKG = '@aikidosec/safe-chain'

// The registry's answer is trusted only as an exact semver version: it ends up in workflow files and
// in the installer URL.
function fetch_latest_version(): string | undefined {
	const answer = npm_registry.view(SAFE_CHAIN_PKG, 'version')
	if (answer.exit_code !== 0 || !answer.stdout) return undefined

	return npm_registry.valid_version(answer.stdout.trim())
}

// The hash-verified installer pinned in the workflows is the one place a safe-chain release is
// recorded; `preinstall` no longer names one. Every repository moves the
// files that carry the pin — app-kit's own `dast.yml` / `load.yml` included.
function sync(): void {
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
