import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { package_bin_schema } from '#scripts/schemas'

const NODE_MODULES = 'node_modules'
const BIN_DIR = '.bin'
const WINDOWS_PLATFORM = 'win32'
const WINDOWS_SHIM_SUFFIX = '.cmd'
const PACKAGE_JSON = 'package.json'

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

// The string form of `bin` names exactly one executable, and its name is the package's own — so it
// answers only when that is the name being asked for. Reading it unconditionally would hand back
// `tsc`'s entry for a request for `tsserver`, which is a wrong path rather than a missing one.
// The name npm gives that executable is the *unscoped* one: `@scope/name` installs a `name` shim,
// so the comparison is against the basename or a scoped package's string form would never answer.
function read_bin_entry(
	manifest_path: string,
	package_name: string,
	bin_name: string,
): string | undefined {
	const { bin } = package_bin_schema.parse(JSON.parse(readFileSync(manifest_path, 'utf8')))

	if (typeof bin === 'string') return bin_name === path.basename(package_name) ? bin : undefined

	return bin?.[bin_name]
}

// The other way to reach a dependency's CLI: node's own resolution rather than the generated
// `node_modules/.bin` shim. Two failures make this the route that works where the shim does not.
// pnpm writes a shim only for a project's *direct* dependencies, so a CLI this kit depends on has
// none in a consumer's tree — resolving it from this package's own directory finds it anyway. And
// pnpm's shim hardcodes the store path of the version present when it was written: after a bump the
// old store entry is pruned but the shim is not regenerated, so spawning it dies with
// MODULE_NOT_FOUND (joshuafolkken/kit#668). Returns the CLI entry to hand `process.execPath`, or
// nothing when the package, its `bin` field or the entry on disk is missing — every caller has a
// slower route to fall back to, so a failure here is never thrown.
// One constraint worth knowing before adding a caller: this reads the target's manifest through
// `<package>/package.json`, which a package whose `exports` map omits that subpath refuses with
// ERR_PACKAGE_PATH_NOT_EXPORTED. That arrives here as `undefined` like any other miss, so the caller
// degrades to its slower route silently rather than reporting why.
function resolve_package_bin(
	base_directory: string,
	package_name: string,
	bin_name: string,
): string | undefined {
	try {
		const resolve_from = createRequire(path.join(base_directory, PACKAGE_JSON))
		const manifest_path = resolve_from.resolve(`${package_name}/${PACKAGE_JSON}`)
		const bin_entry = read_bin_entry(manifest_path, package_name, bin_name)
		if (bin_entry === undefined) return undefined

		const cli_entry = path.join(path.dirname(manifest_path), bin_entry)

		return existsSync(cli_entry) ? cli_entry : undefined
	} catch {
		return undefined
	}
}

export { find_local_bin_upwards, resolve_local_bin, resolve_package_bin }
