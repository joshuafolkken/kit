import { KIT_PACKAGE_NAME } from './kit-descriptor'

const NODE_MODULES = 'node_modules'
const FIX_GH_PACKAGES_SCRIPT = 'scripts/fix-gh-packages.ts'
const SCOPED_PACKAGE_PATTERN = /^@(?<owner>[^/]+)\/(?<name>.+)$/u

// fix-gh-packages.ts is published only by kit, so every consumer (kit, app-kit, game-kit) repairs
// its lockfile with kit's single copy — kit is always present as a (transitive) dependency. Using
// a per-package path here would point at a script app-kit/game-kit never ship (ERR_MODULE_NOT_FOUND).
const FIX_GH_PACKAGES_PATH = `${NODE_MODULES}/${KIT_PACKAGE_NAME}/${FIX_GH_PACKAGES_SCRIPT}`

// A scoped npm package name split into its scope (the GitHub owner) and unscoped remainder.
interface ScopedPackageName {
	owner: string
	name: string
}

// The inputs shared by every package the version command can report on and upgrade: the main
// package itself and each of its upstreams. All three fields are derivable from the package name.
interface PackageVersionConfig {
	package_name: string
	versions_endpoint: string
	fix_gh_packages_path: string
}

// A consumer's declaration of one upstream package in its dependency chain (e.g. app-kit declares
// kit). Only the package name is needed — the endpoint and repair path are derived from it.
interface UpstreamDescriptor {
	package_name: string
}

// The per-package inputs that turn the generic version-command library into a concrete `version`
// / `version:upgrade` pair. `upstreams` lists the consumer's upstream chain nearest-first (their
// order is preserved in the report); `self_directory` and `resolve_warning` are optional hooks the
// consumer's thin wrapper supplies to reproduce kit's running-binary line and PATH warning.
interface VersionCommandConfig extends PackageVersionConfig {
	upstreams: ReadonlyArray<PackageVersionConfig>
	self_directory?: string
	resolve_warning?: () => string | undefined
}

// Options accepted by the builder: the package name plus the optional upstream chain and display
// hooks. `versions_endpoint` may be supplied to override the derived GitHub Packages endpoint.
interface VersionCommandConfigOptions {
	package_name: string
	versions_endpoint?: string
	upstreams?: ReadonlyArray<UpstreamDescriptor>
	self_directory?: string
	resolve_warning?: () => string | undefined
}

function parse_scoped_package_name(package_name: string): ScopedPackageName | undefined {
	const groups = SCOPED_PACKAGE_PATTERN.exec(package_name)?.groups
	const { owner, name } = groups ?? {}
	if (owner === undefined || name === undefined) return undefined

	return { owner, name }
}

// Derive the GitHub Packages versions endpoint from a scoped package name: the scope is the
// GitHub owner and the unscoped remainder is the package path segment (uniform across
// kit/app-kit/game-kit), so consumers never hardcode another package's endpoint.
function derive_versions_endpoint(package_name: string): string {
	const scoped = parse_scoped_package_name(package_name)

	if (scoped === undefined) {
		throw new Error(`Cannot derive a versions endpoint from unscoped package name: ${package_name}`)
	}

	return `/users/${scoped.owner}/packages/npm/${scoped.name}/versions?per_page=1`
}

// Resolve an upstream descriptor into a full per-package config. Every package in the chain repairs
// its lockfile with kit's single `fix-gh-packages.ts` (see FIX_GH_PACKAGES_PATH).
function resolve_upstream(descriptor: UpstreamDescriptor): PackageVersionConfig {
	return {
		package_name: descriptor.package_name,
		versions_endpoint: derive_versions_endpoint(descriptor.package_name),
		fix_gh_packages_path: FIX_GH_PACKAGES_PATH,
	}
}

// Build a config from a consumer's inputs, assigning the optional hooks only when defined so the
// object stays compatible with `exactOptionalPropertyTypes`.
function create_version_command_config(options: VersionCommandConfigOptions): VersionCommandConfig {
	const config: VersionCommandConfig = {
		package_name: options.package_name,
		versions_endpoint: options.versions_endpoint ?? derive_versions_endpoint(options.package_name),
		fix_gh_packages_path: FIX_GH_PACKAGES_PATH,
		upstreams: (options.upstreams ?? []).map((descriptor) => resolve_upstream(descriptor)),
	}
	if (options.self_directory !== undefined) config.self_directory = options.self_directory
	if (options.resolve_warning !== undefined) config.resolve_warning = options.resolve_warning

	return config
}

export type {
	PackageVersionConfig,
	UpstreamDescriptor,
	VersionCommandConfig,
	VersionCommandConfigOptions,
}
export { create_version_command_config, derive_versions_endpoint }
