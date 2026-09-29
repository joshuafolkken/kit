// `setup-ci` only writes shims and adds them to PATH on a CI runner, so a local `pnpm install` is
// scanned only when the developer has enabled safe-chain's own shell integration. That integration
// runs pnpm behind safe-chain's registry proxy and hands `GLOBAL_AGENT_HTTP_PROXY` to it, which a bare
// pnpm never sets — the one signal a lifecycle script can read (joshuafolkken/kit#2707).
const SETUP_CI_CMD = 'pnpm dlx @aikidosec/safe-chain setup-ci'
const LEGACY_PREINSTALL_RE = /^pnpm dlx @aikidosec\/safe-chain(?:@\S+)? setup-ci$/u
const INTEGRATION_HINT =
	'Warning: safe-chain is not scanning this install because its shell integration is not active.' +
	' Install safe-chain (https://github.com/AikidoSec/safe-chain#installation) or run: safe-chain setup' +
	' - then restart your terminal.'
// `preinstall` runs before any dependency is installed, kit included, so the check is plain Node with
// no imports. It never fails the install and stays silent on CI, where the runner is set up instead.
// The source avoids double quotes, `$` and backticks so the shell passes it to Node verbatim.
const LOCAL_INTEGRATION_CHECK_SOURCE = `if(!process.env.CI&&!process.env.GLOBAL_AGENT_HTTP_PROXY)console.warn('${INTEGRATION_HINT}')`
const LOCAL_INTEGRATION_CHECK_CMD = `node -e "${LOCAL_INTEGRATION_CHECK_SOURCE}"`

function with_local_check(setup_command: string): string {
	return `${setup_command} && ${LOCAL_INTEGRATION_CHECK_CMD}`
}

// Upgrade a `preinstall` kit wrote before the check existed, pinned version included; any other
// value is the consumer's own and is left exactly as it is.
function migrate_preinstall(value: string): string {
	if (!LEGACY_PREINSTALL_RE.test(value)) return value

	return with_local_check(value)
}

const SAFE_CHAIN_CMD = with_local_check(SETUP_CI_CMD)

const safe_chain_preinstall = {
	SAFE_CHAIN_CMD,
	LOCAL_INTEGRATION_CHECK_CMD,
	LOCAL_INTEGRATION_CHECK_SOURCE,
	INTEGRATION_HINT,
	migrate_preinstall,
}

export { safe_chain_preinstall }
