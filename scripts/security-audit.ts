#!/usr/bin/env tsx
import { accessSync, constants, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { execaSync } from 'execa'
import { security_audit_logic } from './security-audit-logic'

const FAILURE_EXIT_CODE = 1

// execa reports `exitCode: undefined` only when the binary could not be spawned
// (ENOENT); a non-zero `--version` exit still means the binary exists.
function is_binary_available(binary_name: string): boolean {
	const result = execaSync(binary_name, ['--version'], { stdio: 'ignore', reject: false })

	return result.exitCode !== undefined
}

// Existence is not the question a provisioned binary has to answer. An interrupted install, a
// `chmod` refused by a `noexec` mount or a zero-byte leftover all satisfy `existsSync`, and spawning
// one of those fails with EACCES or ENOEXEC — an error that names neither the scanner nor how to get
// one, and that `josh audit:provision` would refuse to repair because something is already there.
function is_executable_file(candidate_path: string): boolean {
	try {
		accessSync(candidate_path, constants.X_OK)
		const stats = statSync(candidate_path)

		// `X_OK` succeeds on any traversable directory, and a directory's reported size is never zero,
		// so both other clauses pass for one — reintroducing the very failure this check removes.
		return stats.isFile() && stats.size > 0
	} catch {
		return false
	}
}

// PATH first, so a machine that already installed the scanner keeps using exactly the binary it
// installed and this run behaves as it always did; the directory `josh audit:provision` writes to is
// the fallback, not the preference (joshuafolkken/kit#1563). `undefined` means neither answered — the
// caller reports how to get one rather than spawning a name that cannot resolve.
function resolve_scanner_path(project_root: string, platform: string): string | undefined {
	const { BINARY_NAME, build_managed_binary_path } = security_audit_logic
	if (is_binary_available(BINARY_NAME)) return BINARY_NAME

	const managed_path = build_managed_binary_path(project_root, platform)

	return is_executable_file(managed_path) ? managed_path : undefined
}

function run_scanner(scanner_path: string): number {
	const { LOCKFILE_PATH, build_scanner_arguments } = security_audit_logic
	const result = execaSync(scanner_path, [...build_scanner_arguments(LOCKFILE_PATH)], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAILURE_EXIT_CODE
}

function main(): never {
	const { BINARY_NAME, format_missing_binary_error } = security_audit_logic
	const scanner_path = resolve_scanner_path(PROJECT_ROOT, process.platform)

	if (scanner_path === undefined) {
		console.error(format_missing_binary_error(BINARY_NAME))
		process.exit(FAILURE_EXIT_CODE)
	}

	process.exit(run_scanner(scanner_path))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const security_audit = {
	is_binary_available,
	is_executable_file,
	resolve_scanner_path,
	run_scanner,
}

export { security_audit }
