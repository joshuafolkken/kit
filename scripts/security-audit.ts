#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { security_audit_logic } from './security-audit-logic'

const FAILURE_EXIT_CODE = 1

function is_binary_available(binary_name: string): boolean {
	const result = spawnSync(binary_name, ['--version'], { stdio: 'ignore' })

	return result.error === undefined
}

function main(): never {
	const { BINARY_NAME, LOCKFILE_PATH, build_scanner_arguments, format_missing_binary_error } =
		security_audit_logic

	if (!is_binary_available(BINARY_NAME)) {
		console.error(format_missing_binary_error(BINARY_NAME))
		process.exit(FAILURE_EXIT_CODE)
	}

	const result = spawnSync(BINARY_NAME, [...build_scanner_arguments(LOCKFILE_PATH)], {
		stdio: 'inherit',
	})

	process.exit(result.status ?? FAILURE_EXIT_CODE)
}

main()
