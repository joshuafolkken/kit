const NODE_MODULES = 'node_modules'
const FIX_GH_PACKAGES_SCRIPT = 'scripts/fix-gh-packages.ts'

// The per-package inputs that turn the generic version-command library into a concrete `version`
// / `version:upgrade` pair. `package_name` and `versions_endpoint` are the two required inputs
// from the issue; `self_directory` and `resolve_warning` are optional hooks the consumer's thin
// wrapper supplies to reproduce kit's running-binary line and PATH-shadowing warning.
interface VersionCommandConfig {
	package_name: string
	versions_endpoint: string
	fix_gh_packages_path: string
	self_directory?: string
	resolve_warning?: () => string | undefined
}

// Options accepted by the builder: the two required inputs plus the optional display hooks. The
// fix-gh-packages path is derived from the package name so consumers never hand-write it.
interface VersionCommandConfigOptions {
	package_name: string
	versions_endpoint: string
	self_directory?: string
	resolve_warning?: () => string | undefined
}

// The lockfile-repair script lives at the package root under node_modules, so the relative path is
// `node_modules/<package_name>/scripts/fix-gh-packages.ts` for any consuming package.
function derive_fix_gh_packages_path(package_name: string): string {
	return `${NODE_MODULES}/${package_name}/${FIX_GH_PACKAGES_SCRIPT}`
}

// Build a config from a consumer's inputs, assigning the optional hooks only when defined so the
// object stays compatible with `exactOptionalPropertyTypes`.
function create_version_command_config(options: VersionCommandConfigOptions): VersionCommandConfig {
	const config: VersionCommandConfig = {
		package_name: options.package_name,
		versions_endpoint: options.versions_endpoint,
		fix_gh_packages_path: derive_fix_gh_packages_path(options.package_name),
	}
	if (options.self_directory !== undefined) config.self_directory = options.self_directory
	if (options.resolve_warning !== undefined) config.resolve_warning = options.resolve_warning

	return config
}

export type { VersionCommandConfig, VersionCommandConfigOptions }
export { create_version_command_config }
