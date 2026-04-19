import path from 'node:path'

const JOSH_BIN_NAME = 'josh'
const LOCAL_BIN_DIRNAME = '.local/bin'

function resolve_local_bin_directory(home_directory: string): string {
	return path.join(home_directory, LOCAL_BIN_DIRNAME)
}

function resolve_bin_path(home_directory: string): string {
	return path.join(resolve_local_bin_directory(home_directory), JOSH_BIN_NAME)
}

function resolve_tsx_path(cwd: string): string {
	return path.join(cwd, 'node_modules', '.bin', 'tsx')
}

function resolve_josh_script_path(package_directory: string): string {
	return path.join(package_directory, 'scripts', 'josh.ts')
}

function generate_wrapper_script(tsx_path: string, josh_script_path: string): string {
	return `#!/bin/sh\nexec "${tsx_path}" "${josh_script_path}" "$@"\n`
}

function is_dependency_install(package_directory: string, init_cwd: string): boolean {
	if (init_cwd === '') return false

	return init_cwd !== package_directory
}

function is_bin_directory_on_path(bin_directory: string, path_environment: string): boolean {
	return path_environment.split(':').includes(bin_directory)
}

function format_success(bin_path: string): string {
	return `  ✔ ${bin_path} installed`
}

function format_path_hint(bin_directory: string): string {
	return `  💡 Add to ~/.zshrc or ~/.zprofile:\n     export PATH="${bin_directory}:$PATH"`
}

function format_skip(): string {
	return '  ⏭ josh install skipped (installed as dependency)'
}

const install_bin_logic = {
	resolve_local_bin_directory,
	resolve_bin_path,
	resolve_tsx_path,
	resolve_josh_script_path,
	generate_wrapper_script,
	is_dependency_install,
	is_bin_directory_on_path,
	format_success,
	format_path_hint,
	format_skip,
}

export { install_bin_logic }
