import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { package_version_schema } from '#scripts/schemas'

const PACKAGE_JSON = 'package.json'
// Scripts live two levels under the package root (scripts/<group>/<file>.ts), so the running
// binary's own package.json is reached by walking up twice from the script directory.
const SCRIPT_DEPTH_FROM_ROOT = ['..', '..'] as const

function safe_json_parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		return undefined
	}
}

// The running binary is the single source of truth: resolve the package.json of the install that
// is actually executing (via import.meta.url's directory), mirroring how `init`/`sync` key off the
// package directory rather than `pnpm ls -g` or `<cwd>/node_modules`.
function resolve_self_package_path(self_directory: string): string {
	return path.join(self_directory, ...SCRIPT_DEPTH_FROM_ROOT, PACKAGE_JSON)
}

// Absolute directory of the running binary's package root — the path reported as the source of the
// version that actually ran.
function running_package_directory(self_directory: string): string {
	return path.resolve(self_directory, ...SCRIPT_DEPTH_FROM_ROOT)
}

// Read the version declared in the running binary's own package.json. Undefined only when the file
// is missing or malformed (should not happen for a real install, but kept total for safety).
function read_running_version(self_directory: string): string | undefined {
	const package_path = resolve_self_package_path(self_directory)
	if (!existsSync(package_path)) return undefined
	const parsed = package_version_schema.safeParse(
		safe_json_parse(readFileSync(package_path, 'utf8')),
	)

	return parsed.success ? parsed.data.version : undefined
}

const running_binary = {
	resolve_self_package_path,
	running_package_directory,
	read_running_version,
}

export { running_binary }
