import path from 'node:path'

const NODE_MODULES = 'node_modules'
const BIN_DIR = '.bin'
const WINDOWS_PLATFORM = 'win32'
const WINDOWS_SHIM_SUFFIX = '.cmd'

// Every spawn site that reaches for a locally-installed CLI needs the same two details: pnpm
// writes the shims under `node_modules/.bin`, and on Windows the executable one carries a
// `.cmd` suffix (execa resolves and escapes that shim itself, so no `shell` option is needed).
// Resolving it here keeps the spawn sites — josh's tsx runner, `josh init`'s lefthook install,
// the secretlint pre-commit scan and the cspell distribution guard — from drifting apart. The
// lefthook one had already lost the `.cmd` suffix, so it failed to spawn on Windows.
function resolve_local_bin(project_root: string, bin_name: string): string {
	const shim =
		process.platform === WINDOWS_PLATFORM ? `${bin_name}${WINDOWS_SHIM_SUFFIX}` : bin_name

	return path.join(project_root, NODE_MODULES, BIN_DIR, shim)
}

export { resolve_local_bin }
