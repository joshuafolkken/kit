import { execaSync } from 'execa'
import { running_binary } from './running-binary'
import {
	version_check_logic,
	type RunningBinary,
	type VersionOutputExtras,
	type VersionSnapshot,
} from './version-check-logic'
import type { VersionCommandConfig } from './version-command-config'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

const FAILURE_EXIT_CODE = 1
const ALREADY_UP_TO_DATE = 'Already up to date'

// Read the global, project, and latest versions for the configured package — the three values a
// single `version` / `version:upgrade` invocation operates on.
function read_snapshot(config: VersionCommandConfig): VersionSnapshot {
	return {
		global_version: version_targets.read_global_version(config.package_name),
		project_version: version_targets.read_project_version(process.cwd(), config.package_name),
		latest: fetch_latest_version(config.versions_endpoint),
	}
}

// The running binary is the single source of truth: report the version/path of the install that
// actually executed. Undefined when the consumer supplies no `self_dir` or the binary is unknown.
function read_running_binary(self_directory: string | undefined): RunningBinary | undefined {
	if (self_directory === undefined) return undefined
	const version = running_binary.read_running_version(self_directory)
	if (version === undefined) return undefined

	return { version, path: running_binary.running_package_directory(self_directory) }
}

// Build the optional report extras (running-binary line + PATH-shadowing warning) from the
// consumer's hooks, assigning only defined values to stay `exactOptionalPropertyTypes`-compatible.
function build_extras(config: VersionCommandConfig): VersionOutputExtras {
	const extras: VersionOutputExtras = {}
	const running = read_running_binary(config.self_directory)
	if (running !== undefined) extras.running = running
	const warning = config.resolve_warning?.()
	if (warning !== undefined) extras.warning = warning

	return extras
}

// The `version` (show) command for any configured package: print the dual/offline report with
// staleness markers, upgrade hints, and the optional running-binary/warning extras.
function run_check(config: VersionCommandConfig): void {
	const snapshot = read_snapshot(config)

	console.info(
		version_check_logic.format_dual_version_output(snapshot, config, build_extras(config)),
	)
}

function run_upgrade_command(command: string): number {
	const result = execaSync('sh', ['-c', command], { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAILURE_EXIT_CODE
}

// Run every upgrade command in order, returning the last non-zero exit code (or 0 when all
// succeed) so a failure on either target is surfaced without aborting the remaining upgrades.
function run_all_upgrade_commands(commands: ReadonlyArray<string>): number {
	let exit_code = 0

	for (const command of commands) {
		const code = run_upgrade_command(command)
		if (code !== 0) exit_code = code
	}

	return exit_code
}

// The `version:upgrade` command for any configured package: upgrade whichever of global/project
// are stale (respecting the fix-gh-packages lockfile repair). Returns the process exit code.
function run_upgrade(config: VersionCommandConfig): number {
	const snapshot = read_snapshot(config)
	const commands = version_check_logic.build_dual_upgrade_commands(snapshot, config)

	if (commands.length === 0) console.info(ALREADY_UP_TO_DATE)

	return run_all_upgrade_commands(commands)
}

const version_commands = {
	read_snapshot,
	build_extras,
	run_check,
	run_upgrade,
	run_upgrade_command,
	run_all_upgrade_commands,
}

export { version_commands }
