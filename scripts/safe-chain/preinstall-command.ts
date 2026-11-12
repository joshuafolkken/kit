// Preinstall checks the registry proxy signal without fetching an unverified package during the
// install it is meant to protect. Safe-chain's shell integration supplies GLOBAL_AGENT_HTTP_PROXY;
// bare pnpm does not, making it the available lifecycle-script signal.
const INSTALL_GUIDE_ANCHOR = 'installing-safe-chain'
const INSTALL_GUIDE_URL = `https://github.com/joshuafolkken/kit/blob/main/SECURITY.md#${INSTALL_GUIDE_ANCHOR}`
// `.pnpmfile.mjs` recognizes the command by the package name, so the hint names it.
const INTEGRATION_HINT =
	'Warning: safe-chain (@aikidosec/safe-chain) is not scanning this install because its shell' +
	` integration is not active. Install it with the hash-verified steps at ${INSTALL_GUIDE_URL}` +
	' - then restart your terminal.'
// `preinstall` runs before any dependency is installed, kit included, so the check is plain Node with
// no imports. It never fails the install and stays silent on CI, where the runner is set up instead.
// The source avoids double quotes, `$` and backticks so the shell passes it to Node verbatim.
const LOCAL_INTEGRATION_CHECK_SOURCE = `if(!process.env.CI&&!process.env.GLOBAL_AGENT_HTTP_PROXY)console.warn('${INTEGRATION_HINT}')`
const SAFE_CHAIN_CMD = `node -e "${LOCAL_INTEGRATION_CHECK_SOURCE}"`
// Every `preinstall` an earlier kit wrote: `setup-ci` alone, pinned or not, or followed by the
// `node -e` check of any earlier wording. Removable from kit 2.0.0; consumers still carried `setup-ci`
// at joshuafolkken/kit#4187.
const LEGACY_PREINSTALL_RE =
	/^pnpm dlx @aikidosec\/safe-chain(?:@\S+)? setup-ci(?: && node -e "[^"]*")?$/u

// Replace a `preinstall` kit wrote earlier; any other value is the consumer's own and is left exactly
// as it is.
function migrate_preinstall(value: string): string {
	return LEGACY_PREINSTALL_RE.test(value) ? SAFE_CHAIN_CMD : value
}

const safe_chain_preinstall = {
	SAFE_CHAIN_CMD,
	LOCAL_INTEGRATION_CHECK_SOURCE,
	INTEGRATION_HINT,
	INSTALL_GUIDE_ANCHOR,
	migrate_preinstall,
}

export { safe_chain_preinstall }
