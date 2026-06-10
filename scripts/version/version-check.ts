#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { doctor_io } from '#scripts/doctor/doctor-io'
import { doctor_logic } from '#scripts/doctor/doctor-logic'
import { running_binary } from './running-binary'
import {
	version_check_logic,
	type RunningBinary,
	type VersionOutputExtras,
} from './version-check-logic'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))

// The running binary is the single source of truth: report the version/path of the install that
// actually executed, alongside the global/project breakdown.
function read_running_binary(): RunningBinary | undefined {
	const version = running_binary.read_running_version(SELF_DIR)
	if (version === undefined) return undefined

	return { version, path: running_binary.running_package_directory(SELF_DIR) }
}

// Warn when the `josh` first on PATH is not the pnpm-global install (a stale shim shadowing it),
// pointing at the `doctor --fix` recovery command.
function read_shadow_warning(): string | undefined {
	const path_josh = doctor_io.resolve_path_josh()
	const global_josh = doctor_io.resolve_pnpm_global_josh()
	if (path_josh === undefined || global_josh === undefined) return undefined
	if (!doctor_logic.is_shadowed(path_josh, global_josh)) return undefined

	return doctor_logic.format_shadow_warning(path_josh, global_josh)
}

// Build the optional extras, assigning only defined values so the object stays compatible with
// `exactOptionalPropertyTypes` (never an explicit `undefined`).
function build_extras(): VersionOutputExtras {
	const extras: VersionOutputExtras = {}
	const running = read_running_binary()
	if (running !== undefined) extras.running = running
	const warning = read_shadow_warning()
	if (warning !== undefined) extras.warning = warning

	return extras
}

function main(): void {
	const global_version = version_targets.read_global_version()
	const project_version = version_targets.read_project_version(process.cwd())
	const latest = fetch_latest_version()

	console.info(
		version_check_logic.format_dual_version_output(
			global_version,
			project_version,
			latest,
			build_extras(),
		),
	)
}

main()
