import path from 'node:path'

const PACKAGE_NAME = '@joshuafolkken/kit'
const PACKAGE_JSON = 'package.json'
const LOCAL_MODULES_DIR = 'node_modules'
const FIX_GH_PACKAGES_REL = 'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'

// The running binary is the single source of truth: `josh v`/`vu` report and update the
// install that actually executes, mirroring how `init`/`sync` key off PACKAGE_DIR.
function resolve_package_path(self_directory: string): string {
	return path.join(self_directory, '..', PACKAGE_JSON)
}

// Local (`pnpm josh`) when the running binary lives under `<cwd>/node_modules`;
// global (`josh`) when it resolves anywhere else (e.g. the global pnpm store).
function is_local_install(cwd: string, self_directory: string): boolean {
	const local_modules = path.resolve(cwd, LOCAL_MODULES_DIR)
	const normalized_self = path.resolve(self_directory)

	return normalized_self === local_modules || normalized_self.startsWith(local_modules + path.sep)
}

function update_scope_flag(is_local: boolean): string {
	return is_local ? '-D' : '-g'
}

function format_version_status(current: string, latest: string): string {
	if (current === latest) return '✓ Up to date'

	return `⚠ Update available: ${current} → ${latest}`
}

function format_update_command(latest: string, is_local: boolean): string {
	return `pnpm add ${update_scope_flag(is_local)} ${PACKAGE_NAME}@${latest}`
}

function build_upgrade_shell_command(latest: string, is_local: boolean): string {
	const add_command = format_update_command(latest, is_local)
	if (!is_local) return add_command

	return `${add_command} && node_modules/.bin/tsx ${FIX_GH_PACKAGES_REL}`
}

function format_version_output(current: string, latest: string, is_local: boolean): string {
	const lines = [
		`Current: ${current}`,
		`Latest:  ${latest}`,
		format_version_status(current, latest),
	]

	if (current !== latest) {
		lines.push('', `Run: ${format_update_command(latest, is_local)}`)
	}

	return lines.join('\n')
}

const version_check_logic = {
	PACKAGE_NAME,
	resolve_package_path,
	is_local_install,
	format_version_output,
	format_update_command,
	build_upgrade_shell_command,
}

export { version_check_logic }
