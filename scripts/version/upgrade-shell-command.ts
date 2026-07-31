import type { PackageVersionConfig } from './version-command-config'

function update_scope_flag(is_local: boolean): string {
	return is_local ? '-D' : '-g'
}

// The bare `pnpm add` invocation that installs one package at an exact version, in the global or the
// project (dev-dependency) scope.
function format_update_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): string {
	return `pnpm add ${update_scope_flag(is_local)} ${config.package_name}@${latest}`
}

// The full shell command for one upgrade target. A project-scope install is chained with kit's
// lockfile repair (`fix-gh-packages`), which a global install does not need.
function build_upgrade_shell_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): string {
	const add_command = format_update_command(latest, is_local, config)
	if (!is_local) return add_command

	return `${add_command} && node_modules/.bin/tsx ${config.fix_gh_packages_path}`
}

export { build_upgrade_shell_command, format_update_command }
