import { createRequire } from 'node:module'
import path from 'node:path'
import { ancestor_directories } from '#scripts/lib/ancestor-directories'
import { package_manifest } from '#scripts/lib/package-manifest'
import { package_named_version_schema } from '#scripts/lib/schemas'

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
function read_matching_version(directory: string, package_name: string): string | undefined {
	const manifest = package_manifest.read_manifest_if_valid(directory, package_named_version_schema)
	if (manifest?.name !== package_name) return undefined

	return manifest.version
}

// Walk up from a resolved file's directory to the package root, returning the version of the first
// ancestor package.json whose `name` matches the target — or undefined when no matching root exists.
function walk_up_for_version(start_directory: string, package_name: string): string | undefined {
	for (const directory of ancestor_directories.list(start_directory)) {
		const version = read_matching_version(directory, package_name)
		if (version !== undefined) return version
	}

	return undefined
}

// Resolve the package (or its marker subpath) relative to `base_url`, returning the absolute file
// path require lands on — or undefined when the specifier cannot be resolved from that base.
function resolve_from_base(
	base_url: string,
	package_name: string,
	resolve_marker = package_name,
): string | undefined {
	try {
		return createRequire(base_url).resolve(resolve_marker)
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
