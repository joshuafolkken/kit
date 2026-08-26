import { existsSync } from 'node:fs'
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

// pnpm finds a shim by walking up from the working directory, so a caller that resolved only the
// directory it was invoked in would disagree with the very commands it spawns — `josh gate` typed
// in `src/lib` would miss the toolkit its sibling checks resolve fine (joshuafolkken/kit#934).
// Ascending for the shim itself, rather than for a `package.json` first, is what keeps the two in
// step: a nested manifest that owns no `node_modules` is not where pnpm would stop either.
function ancestor_directories(start_directory: string): ReadonlyArray<string> {
	const directories: Array<string> = []
	let current = start_directory

	while (!directories.includes(current)) {
		directories.push(current)
		current = path.dirname(current)
	}

	return directories
}

function find_local_bin_upwards(start_directory: string, bin_name: string): string | undefined {
	return ancestor_directories(start_directory)
		.map((directory) => resolve_local_bin(directory, bin_name))
		.find((candidate) => existsSync(candidate))
}

export { find_local_bin_upwards, resolve_local_bin }
