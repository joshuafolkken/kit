#!/usr/bin/env tsx
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { install_bin_logic } from './install-bin-logic'

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const INIT_CWD = process.env['INIT_CWD'] ?? ''
const WRAPPER_MODE = 0o755

function write_wrapper(bin_path: string, content: string): void {
	writeFileSync(bin_path, content)
	chmodSync(bin_path, WRAPPER_MODE)
}

function print_path_hint_if_needed(bin_directory: string): void {
	const path_environment = process.env['PATH'] ?? ''

	if (!install_bin_logic.is_bin_directory_on_path(bin_directory, path_environment)) {
		console.info(install_bin_logic.format_path_hint(bin_directory))
	}
}

function install_josh_bin(): void {
	const home_directory = os.homedir()
	const bin_directory = install_bin_logic.resolve_local_bin_directory(home_directory)
	const bin_path = install_bin_logic.resolve_bin_path(home_directory)
	const tsx_path = install_bin_logic.resolve_tsx_path(process.cwd())
	const josh_script = install_bin_logic.resolve_josh_script_path(PKG_DIR)
	const content = install_bin_logic.generate_wrapper_script(tsx_path, josh_script)

	mkdirSync(bin_directory, { recursive: true })
	write_wrapper(bin_path, content)
	console.info(install_bin_logic.format_success(bin_path))
	print_path_hint_if_needed(bin_directory)
}

function install_josh_bin_section(): void {
	console.info('\nJosh bin:')

	try {
		install_josh_bin()
	} catch {
		console.warn('  ⚠ josh bin install failed — run manually: josh install')
	}
}

function main(): void {
	if (install_bin_logic.is_dependency_install(PKG_DIR, INIT_CWD)) {
		console.info(install_bin_logic.format_skip())

		return
	}

	install_josh_bin()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

export { install_josh_bin, install_josh_bin_section }
