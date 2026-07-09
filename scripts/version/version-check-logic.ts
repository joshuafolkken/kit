import type { PackageVersionConfig } from './version-command-config'

function update_scope_flag(is_local: boolean): string {
	return is_local ? '-D' : '-g'
}

function format_update_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
): string {
	return `pnpm add ${update_scope_flag(is_local)} ${config.package_name}@${latest}`
}

function build_upgrade_shell_command(
	latest: string,
	is_local: boolean,
	config: PackageVersionConfig,
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

// An upstream's effective (running-relative) install, resolved by the consumer's opt-in hook — the
// upstream version actually executed when the downstream CLI runs (e.g. the kit bundled inside the
// running global app-kit, resolved via createRequire, NOT `pnpm ls -g`). `version` is undefined
// when genuinely unresolved ("not installed"); `upgrade_command` is the consumer's global command
// that bumps this effective install (e.g. `pnpm add -g @joshuafolkken/app-kit@<latest>` — routed
// through the downstream CLI, since that is what upgrades the bundled upstream).
interface UpstreamEffective {
	version: string | undefined
	upgrade_command: string
}

// One upstream package's check result: the resolved upstream config plus the project version the
// project-scope report compares, and an optional effective/global install (present only when the
// consumer opts in). Absent `effective` falls back to the original project/latest-only output.
interface UpstreamReport {
	config: PackageVersionConfig
	project_version: string | undefined
	latest: string
	effective?: UpstreamEffective
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

// Render the upstream's effective/global line, or nothing when the consumer did not opt in. When
// opted in, an unresolved effective install renders "not installed" (never silently omitted).
function format_upstream_global_line(report: UpstreamReport): Array<string> {
	if (report.effective === undefined) return []

	return [format_target_line(GLOBAL_LABEL, report.effective.version, report.latest)]
}

// Render one upstream's report section: package name header, the optional effective/global line,
// then the project/latest lines, reusing the staleness markers of the main report. Prefixed with a
// blank line to separate sections. Global precedes project to mirror the main report's ordering.
function format_upstream_lines(report: UpstreamReport): Array<string> {
	return [
		'',
		report.config.package_name,
		...format_upstream_global_line(report),
		format_target_line(PROJECT_LABEL, report.project_version, report.latest),
		`  ${LATEST_LABEL} ${report.latest}`,
	]
}

// The consumer-supplied global upgrade command for a stale effective upstream, or nothing. Skipped
// when the consumer did not opt in or the effective install is up to date / unresolved.
function build_effective_upgrade_commands(report: UpstreamReport): Array<string> {
	const { effective, latest } = report
	if (effective === undefined) return []
	if (!is_target_stale(effective.version, latest)) return []

	return [effective.upgrade_command]
}

// The project-scope upgrade command when the upstream's project dependency is installed and stale.
// Always local (with lockfile repair), since the project path is the only scope kit resolves.
function build_project_upgrade_commands(report: UpstreamReport): Array<string> {
	if (!is_target_stale(report.project_version, report.latest)) return []

	return [build_upgrade_shell_command(report.latest, true, report.config)]
}

// Build the upgrade commands for every upstream: the consumer's global command for a stale effective
// install first, then the project-scope command, mirroring the main report's global-before-project
// order. Upstreams without either stale target contribute nothing.
function build_upstream_upgrade_commands(reports: ReadonlyArray<UpstreamReport>): Array<string> {
	return reports.flatMap((report) => [
		...build_effective_upgrade_commands(report),
		...build_project_upgrade_commands(report),
	])
}

// Build the shell upgrade commands for whichever of the two targets are installed and stale.
// Order: global first, then project (mirrors the display order).
function build_dual_upgrade_commands(
	snapshot: VersionSnapshot,
	config: PackageVersionConfig,
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

// The full report: the main package's section, one section per upstream (nearest-first, in the
// configured order), then the merged upgrade hints and the optional PATH warning.
function format_dual_version_output(
	snapshot: VersionSnapshot,
	config: PackageVersionConfig,
	extras: VersionOutputExtras = {},
	upstreams: ReadonlyArray<UpstreamReport> = [],
): string {
	const lines = [
		config.package_name,
		...format_target_lines(snapshot),
		...format_running_line(extras.running),
		...upstreams.flatMap((report) => format_upstream_lines(report)),
	]
	const hints = [
		...build_dual_upgrade_commands(snapshot, config),
		...build_upstream_upgrade_commands(upstreams),
	].map((command) => `Run: ${command}`)
	if (hints.length > 0) lines.push('', ...hints)
	if (extras.warning !== undefined) lines.push('', extras.warning)

	return lines.join('\n')
}

const version_check_logic = {
	format_dual_version_output,
	format_running_line,
	format_upstream_lines,
	format_upstream_global_line,
	build_dual_upgrade_commands,
	build_upstream_upgrade_commands,
	build_effective_upgrade_commands,
	build_project_upgrade_commands,
	format_update_command,
	build_upgrade_shell_command,
}

export type {
	VersionSnapshot,
	RunningBinary,
	VersionOutputExtras,
	UpstreamReport,
	UpstreamEffective,
}
export { version_check_logic }
