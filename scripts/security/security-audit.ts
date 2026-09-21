#!/usr/bin/env tsx
import { accessSync, constants, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { execaSync } from 'execa'
import { security_audit_logic } from './security-audit-logic'
import { security_audit_provision_logic } from './security-audit-provision-logic'

const FAILURE_EXIT_CODE = 1
const UNKNOWN_VERSION = 'unknown'

// execa reports `exitCode: undefined` only when the binary could not be spawned
// (ENOENT); a non-zero `--version` exit still means the binary exists.
function is_binary_available(binary_name: string): boolean {
	const result = execaSync(binary_name, ['--version'], { stdio: 'ignore', reject: false })

	return result.exitCode !== undefined
}

// The scanner's own reported version, or `undefined` when it could not be spawned or printed nothing
// a version could be read from. Captured through the default piped stdio rather than the `ignore` the
// availability probe uses, because the version is exactly what has to be read back here.
function scanner_version(binary_or_path: string): string | undefined {
	const result = execaSync(binary_or_path, ['--version'], { reject: false })
	if (result.exitCode === undefined) return undefined

	return security_audit_provision_logic.parse_scanner_version(result.stdout)
}

// Whether the binary at this name or path parses the whole lockfile, i.e. is at or above the pinned
// floor. A version that cannot be read is not the floor met — an unspawnable or version-less binary
// is treated as below it, never as a pass (joshuafolkken/kit#2200).
function meets_floor(binary_or_path: string): boolean {
	const version = scanner_version(binary_or_path)

	return version !== undefined && security_audit_provision_logic.meets_version_floor(version)
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

interface ScannerChoice {
	path: string
	is_below_floor: boolean
}

// A provisioned copy counts only when it is both a real executable and at or above the floor: a
// leftover from an earlier pinned version would otherwise be preferred over the PATH binary while
// reading less of the lockfile than it should.
function managed_scanner(project_root: string, platform: string): string | undefined {
	const managed_path = security_audit_logic.build_managed_binary_path(project_root, platform)

	return is_executable_file(managed_path) && meets_floor(managed_path) ? managed_path : undefined
}

// PATH first, but only when its scanner meets the floor: an older PATH build reads a fraction of the
// lockfile and calls it clean (joshuafolkken/kit#2200), so a provisioned v2.6.0 is preferred over it
// rather than the other way round (the preference of joshuafolkken/kit#1563 held only while every
// build read the whole file). A below-floor PATH binary is the last resort, returned flagged so the
// audit can warn that its clean result proves nothing. `undefined` means no scanner at all.
function resolve_scanner(project_root: string, platform: string): ScannerChoice | undefined {
	const { BINARY_NAME } = security_audit_logic
	const has_path_binary = is_binary_available(BINARY_NAME)

	if (has_path_binary && meets_floor(BINARY_NAME)) {
		return { path: BINARY_NAME, is_below_floor: false }
	}

	const managed = managed_scanner(project_root, platform)
	if (managed !== undefined) return { path: managed, is_below_floor: false }

	return has_path_binary ? { path: BINARY_NAME, is_below_floor: true } : undefined
}

function run_scanner(scanner_path: string): number {
	const { LOCKFILE_PATH, build_scanner_arguments } = security_audit_logic
	const result = execaSync(scanner_path, [...build_scanner_arguments(LOCKFILE_PATH)], {
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAILURE_EXIT_CODE
}

// The clean result of a below-floor scanner is warned about rather than trusted: it means only that
// a blinkered build read too little of the lockfile to object, which the exit code cannot express.
function warn_below_floor(scanner_path: string): void {
	const version = scanner_version(scanner_path) ?? UNKNOWN_VERSION

	console.warn(security_audit_provision_logic.format_below_floor(version))
}

function main(): never {
	const { BINARY_NAME, format_missing_binary_error } = security_audit_logic
	const choice = resolve_scanner(PROJECT_ROOT, process.platform)

	if (choice === undefined) {
		console.error(format_missing_binary_error(BINARY_NAME))
		process.exit(FAILURE_EXIT_CODE)
	}

	if (choice.is_below_floor) warn_below_floor(choice.path)

	process.exit(run_scanner(choice.path))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const security_audit = {
	is_binary_available,
	is_executable_file,
	meets_floor,
	resolve_scanner,
	run_scanner,
	scanner_version,
}

export { security_audit }
