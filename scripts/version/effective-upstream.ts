import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { package_named_version_schema } from '#scripts/schemas'
import { safe_json_parse } from './parse-json'

const PACKAGE_JSON = 'package.json'
// Node module paths never nest anywhere near this deep; the bound only guards against an unexpected
// filesystem cycle so the walk-up cannot loop forever.
const MAX_WALK_DEPTH = 64

// Options for `resolve_effective_upstream_version`. `resolve_marker` is a subpath specifier used for
// `createRequire().resolve()` when the package root itself is not directly resolvable — e.g. kit does
// not list `package.json` (nor a `.` entry) in `exports`, so a subpath like
// `@joshuafolkken/kit/config-merge` is resolved instead and the walk-up finds the root from there.
interface EffectiveUpstreamOptions {
	resolve_marker?: string
}

// Read the `version` from a package.json only when its `name` matches the target package — undefined
// when the file is missing, malformed, or belongs to a different (e.g. nested) package. Matching by
// name is what lets the walk-up skip intermediate package.json files and land on the true root.
function read_matching_version(manifest_path: string, package_name: string): string | undefined {
	if (!existsSync(manifest_path)) return undefined
	const parsed = package_named_version_schema.safeParse(
		safe_json_parse(readFileSync(manifest_path, 'utf8')),
	)
	if (!parsed.success) return undefined
	if (parsed.data.name !== package_name) return undefined

	return parsed.data.version
}

// The directory itself and each of its ancestors up to the filesystem root, nearest-first. Bounded
// by MAX_WALK_DEPTH so an unexpected filesystem cycle cannot produce an unbounded list.
function ancestor_directories(start_directory: string): Array<string> {
	const directories: Array<string> = []
	let current = start_directory

	for (let depth = 0; depth < MAX_WALK_DEPTH; depth += 1) {
		directories.push(current)
		const parent = path.dirname(current)
		if (parent === current) break
		current = parent
	}

	return directories
}

// Walk up from a resolved file's directory to the package root, returning the version of the first
// ancestor package.json whose `name` matches the target — or undefined when no matching root exists.
function walk_up_for_version(start_directory: string, package_name: string): string | undefined {
	for (const directory of ancestor_directories(start_directory)) {
		const version = read_matching_version(path.join(directory, PACKAGE_JSON), package_name)
		if (version !== undefined) return version
	}

	return undefined
}

// Resolve the package (or its marker subpath) relative to `base_url`, returning the absolute file
// path require lands on — or undefined when the specifier cannot be resolved from that base.
function resolve_from_base(
	base_url: string,
	package_name: string,
	resolve_marker: string | undefined,
): string | undefined {
	try {
		return createRequire(base_url).resolve(resolve_marker ?? package_name)
	} catch {
		return undefined
	}
}

// Resolve `package_name` relative to `base_url` (a module URL — e.g. the running binary's
// `import.meta.url`, or an upstream package.json URL) and return the `version` from that package's
// root package.json: the upstream version *effectively* loaded when running from `base_url`, resolved
// via `createRequire` + walk-up-to-root (matching by name). Returns undefined — never throwing — when
// the package is absent or unresolvable. Pass `options.resolve_marker` (a subpath specifier) when the
// package root is not directly `require.resolve`-able because its package.json is not in `exports`.
function resolve_effective_upstream_version(
	base_url: string,
	package_name: string,
	options: EffectiveUpstreamOptions = {},
): string | undefined {
	const resolved = resolve_from_base(base_url, package_name, options.resolve_marker)
	if (resolved === undefined) return undefined

	return walk_up_for_version(path.dirname(resolved), package_name)
}

export type { EffectiveUpstreamOptions }
export { resolve_effective_upstream_version }
