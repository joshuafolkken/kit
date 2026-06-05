#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { security_audit_logic } from './security-audit-logic'

const FAILURE_EXIT_CODE = 1

// execa reports `exitCode: undefined` only when the binary could not be spawned
// (ENOENT); a non-zero `--version` exit still means the binary exists.
function is_binary_available(binary_name: string): boolean {
	const result = execaSync(binary_name, ['--version'], { stdio: 'ignore', reject: false })

	return result.exitCode !== undefined
}

function run_scanner(): number {
	const { BINARY_NAME, LOCKFILE_PATH, build_scanner_arguments } = security_audit_logic
	const result = execaSync(BINARY_NAME, [...build_scanner_arguments(LOCKFILE_PATH)], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAILURE_EXIT_CODE
}

function main(): never {
	const { BINARY_NAME, format_missing_binary_error } = security_audit_logic

	if (!is_binary_available(BINARY_NAME)) {
		console.error(format_missing_binary_error(BINARY_NAME))
		process.exit(FAILURE_EXIT_CODE)
	}

	process.exit(run_scanner())
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const security_audit = { is_binary_available, run_scanner }

export { security_audit }
