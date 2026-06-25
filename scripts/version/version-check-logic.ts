import type { VersionCommandConfig } from './version-command-config'

function update_scope_flag(is_local: boolean): string {
	return is_local ? '-D' : '-g'
}

function format_update_command(
	latest: string,
	is_local: boolean,
	config: VersionCommandConfig,
): string {
	return `pnpm add ${update_scope_flag(is_local)} ${config.package_name}@${latest}`
}

function build_upgrade_shell_command(
	latest: string,
	is_local: boolean,
	config: VersionCommandConfig,
): string {
	const add_command = format_update_command(latest, is_local, config)
	if (!is_local) return add_command

	return `${add_command} && node_modules/.bin/tsx ${config.fix_gh_packages_path}`
}

const NOT_INSTALLED = 'not installed'
const GLOBAL_LABEL = 'Global: '
const PROJECT_LABEL = 'Project: '
const LATEST_LABEL = 'Latest: '
const RUNNING_LABEL = 'Running:'
const STATUS_PAD_WIDTH = 12

// The three versions a single check reports: the globally installed, the project-local, and the
// latest published. Global/project are undefined when that target is not installed. Grouped into
// one object so the formatters stay within the parameter limit alongside the package config.
interface VersionSnapshot {
	global_version: string | undefined
	project_version: string | undefined
	latest: string
}

// The install that is actually executing (`import.meta.url` resolved): version plus the package
// directory it was loaded from. This restores the running-binary-as-source-of-truth guarantee.
interface RunningBinary {
	version: string
	path: string
}

// Optional extras layered onto the dual-version report: the running-binary line and a PATH
// shadowing warning. Grouped into one object to keep the formatter within the parameter limit.
interface VersionOutputExtras {
	running?: RunningBinary
	warning?: string
}

// Render the running-binary line, or nothing when the running binary is unknown.
function format_running_line(running: RunningBinary | undefined): Array<string> {
	if (running === undefined) return []

	return [`  ${RUNNING_LABEL} ${running.version.padEnd(STATUS_PAD_WIDTH)}(${running.path})`]
}

// A target needs upgrading only when it is installed (defined) and behind the latest.
function is_target_stale(version: string | undefined, latest: string): boolean {
	return version !== undefined && version !== latest
}

function format_target_status(version: string | undefined, latest: string): string {
	if (version === undefined) return NOT_INSTALLED
	if (version === latest) return `${version.padEnd(STATUS_PAD_WIDTH)}✓`

	return `${version.padEnd(STATUS_PAD_WIDTH)}⚠ → ${latest}`
}

function format_target_line(label: string, version: string | undefined, latest: string): string {
	return `  ${label} ${format_target_status(version, latest)}`
}

// Build the shell upgrade commands for whichever of the two targets are installed and stale.
// Order: global first, then project (mirrors the display order).
function build_dual_upgrade_commands(
	snapshot: VersionSnapshot,
	config: VersionCommandConfig,
): Array<string> {
	const { global_version, project_version, latest } = snapshot
	const commands: Array<string> = []

	if (is_target_stale(global_version, latest)) {
		commands.push(build_upgrade_shell_command(latest, false, config))
	}

	if (is_target_stale(project_version, latest)) {
		commands.push(build_upgrade_shell_command(latest, true, config))
	}

	return commands
}

function format_target_lines(snapshot: VersionSnapshot): Array<string> {
	const { global_version, project_version, latest } = snapshot

	return [
		format_target_line(GLOBAL_LABEL, global_version, latest),
		format_target_line(PROJECT_LABEL, project_version, latest),
		`  ${LATEST_LABEL} ${latest}`,
	]
}

function format_dual_version_output(
	snapshot: VersionSnapshot,
	config: VersionCommandConfig,
	extras: VersionOutputExtras = {},
): string {
	const lines = [
		config.package_name,
		...format_target_lines(snapshot),
		...format_running_line(extras.running),
	]
	const hints = build_dual_upgrade_commands(snapshot, config).map((command) => `Run: ${command}`)
	if (hints.length > 0) lines.push('', ...hints)
	if (extras.warning !== undefined) lines.push('', extras.warning)

	return lines.join('\n')
}

const version_check_logic = {
	format_dual_version_output,
	format_running_line,
	build_dual_upgrade_commands,
	format_update_command,
	build_upgrade_shell_command,
}

export type { VersionSnapshot, RunningBinary, VersionOutputExtras }
export { version_check_logic }
