import { release_hold } from './release-hold'
import { is_no_op_upgrade_command, type InstalledVersions } from './upgrade-command-guard'
import { build_upgrade_shell_command, format_update_command } from './upgrade-shell-command'
import type { PackageVersionConfig } from './version-command-config'

const NOT_INSTALLED = 'not installed'
const GLOBAL_LABEL = 'Global: '
const PROJECT_LABEL = 'Project: '
const LATEST_LABEL = 'Latest: '
const RUNNING_LABEL = 'Running:'
const NOTE_LABEL = 'Note:'
const STATUS_PAD_WIDTH = 12

// The three versions a single check reports: the globally installed, the project-local, and the
// latest published. Global/project are undefined when that target is not installed. Grouped into
// one object so the formatters stay within the parameter limit alongside the package config.
interface VersionSnapshot {
	global_version: string | undefined
	project_version: string | undefined
	latest: string
}

// What the local minimum-release-age policy permits an unpinned resolve to reach. Carried only on an
// upstream report, because only the effective install is peer-resolved — every other target is
// upgraded by an explicitly pinned command the window does not block. Optional throughout: a package
// whose publish timestamps could not be read keeps exactly the report it had before
// (joshuafolkken/kit#808).
interface ReleaseHold {
	installable: string
	minimum_age_minutes: number
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

// A stale effective upstream's global upgrade command plus whether running it would provably change
// nothing — the classification that decides between a `Run:` hint and a `Note:` explanation.
interface EffectiveUpgradeHint {
	command: string
	is_no_op: boolean
}

// One upstream package's check result: the resolved upstream config plus the project version the
// project-scope report compares, and an optional effective/global install (present only when the
// consumer opts in). Absent `effective` falls back to the original project/latest-only output.
//
// `installed_versions` is populated only when the consumer declared its global upgrade command
// pin-only (`is_global_upgrade_command_pinned`). It lists the globally-resolved versions kit already
// knows, so a command whose every pin is already installed can be proven dead and replaced with an
// explanation instead of a `Run:` hint (#697). Absent, no command is ever suppressed.
interface UpstreamReport {
	config: PackageVersionConfig
	project_version: string | undefined
	latest: string
	effective?: UpstreamEffective
	installed_versions?: InstalledVersions
	hold?: ReleaseHold
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

// One target line, followed by the hold explanation when that target is the one the release-age
// window is holding back. The note is derived from the target's own version, so a target flagged as
// held always produces one — the flag and the sentence cannot disagree.
function format_held_target_line(
	label: string,
	version: string | undefined,
	latest: string,
	hold: ReleaseHold | undefined,
): Array<string> {
	const notes =
		hold === undefined
			? []
			: release_hold.build_release_hold_notes(
					version,
					latest,
					hold.installable,
					hold.minimum_age_minutes,
				)

	return [format_target_line(label, version, latest), ...notes.map((note) => `  ${note}`)]
}

// Render the upstream's effective/global line, or nothing when the consumer did not opt in. When
// opted in, an unresolved effective install renders "not installed" (never silently omitted).
function format_upstream_global_line(report: UpstreamReport): Array<string> {
	if (report.effective === undefined) return []

	// The effective install is the only peer-resolved target, so it is the only one the window can
	// hold back and the only one that carries the explanation.
	return format_held_target_line(GLOBAL_LABEL, report.effective.version, report.latest, report.hold)
}

// Whether the report carries an effective install that is installed and behind the upstream's latest
// — the single condition under which a global upgrade command applies at all.
function is_effective_stale(report: UpstreamReport): boolean {
	const { effective, latest } = report
	if (effective === undefined) return false

	return is_target_stale(effective.version, latest)
}

// The consumer's global command for a stale effective upstream, classified by whether it can still
// change what kit measured. `is_no_op` is true only when the consumer declared the command pin-only
// and every version it pins is already installed. Undefined when no command applies.
function resolve_effective_upgrade_hint(report: UpstreamReport): EffectiveUpgradeHint | undefined {
	const command = report.effective?.upgrade_command
	if (command === undefined || !is_effective_stale(report)) return undefined

	const installed = report.installed_versions

	return {
		command,
		is_no_op: installed !== undefined && is_no_op_upgrade_command(command, installed),
	}
}

// The consumer-supplied global upgrade command for a stale effective upstream, or nothing. Skipped
// when the consumer did not opt in, the effective install is up to date / unresolved, or the command
// provably cannot change the effective version it was meant to fix (see the note line instead).
function build_effective_upgrade_commands(report: UpstreamReport): Array<string> {
	const hint = resolve_effective_upgrade_hint(report)
	if (hint === undefined || hint.is_no_op) return []

	return [hint.command]
}

// The explanation that replaces a suppressed `Run:` hint, so a stale effective install is never left
// with a bare warning and no account of why kit offers no command for it.
function build_effective_upgrade_notes(report: UpstreamReport): Array<string> {
	const hint = resolve_effective_upgrade_hint(report)
	if (hint?.is_no_op !== true) return []

	return [
		`${NOTE_LABEL} \`${hint.command}\` is already satisfied; it cannot upgrade ${report.config.package_name} to ${report.latest}`,
	]
}

// Every upstream's suppressed-hint explanation, in the configured order.
function build_upstream_upgrade_notes(reports: ReadonlyArray<UpstreamReport>): Array<string> {
	return reports.flatMap((report) => build_effective_upgrade_notes(report))
}

// Render one upstream's report section: package name header, the optional effective/global line and
// its suppressed-hint explanation, then the project/latest lines, reusing the staleness markers of
// the main report. Prefixed with a blank line to separate sections. Global precedes project to
// mirror the main report's ordering.
function format_upstream_lines(report: UpstreamReport): Array<string> {
	return [
		'',
		report.config.package_name,
		...format_upstream_global_line(report),
		...build_effective_upgrade_notes(report).map((note) => `  ${note}`),
		format_target_line(PROJECT_LABEL, report.project_version, report.latest),
		`  ${LATEST_LABEL} ${report.latest}`,
	]
}

// Drop repeated commands while preserving first-seen order. A consumer with several upstreams can
// return the same chain-pinning global command from each of them (game-kit returns one command for
// both app-kit and kit), which would otherwise print an identical `Run:` line once per upstream.
function unique_upgrade_commands(commands: ReadonlyArray<string>): Array<string> {
	return [...new Set(commands)]
}

// The outcome line for an effective install the upgrade command left exactly where it was.
function format_unchanged_outcome(report: UpstreamReport, version: string): string {
	const name = report.config.package_name

	return `${name}: still ${version} — the global upgrade command did not change it (latest ${report.latest})`
}

// The outcome line for an effective install the upgrade moved forward without reaching the latest.
function format_advanced_outcome(report: UpstreamReport, before: string, after: string): string {
	const name = report.config.package_name

	return `${name}: ${before} → ${after} — still behind latest ${report.latest}`
}

// Describe what an upgrade run actually did to an upstream's effective install, comparing the
// re-read version against the one measured before the commands ran. A version that advanced but
// still trails `latest` is a hold (e.g. a minimum-release-age policy withholding the newest
// publish), not a failure — reporting the advance keeps `version:upgrade` honest instead of leaving
// the next `version` to repeat the same warning with no explanation.
function format_effective_outcome(report: UpstreamReport, after: string | undefined): string {
	const previous = report.effective?.version
	const before = previous ?? NOT_INSTALLED
	if (after === previous) return format_unchanged_outcome(report, before)

	return format_advanced_outcome(report, before, after ?? NOT_INSTALLED)
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
	const hints = unique_upgrade_commands([
		...build_dual_upgrade_commands(snapshot, config),
		...build_upstream_upgrade_commands(upstreams),
	]).map((command) => `Run: ${command}`)
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
	build_upstream_upgrade_notes,
	build_effective_upgrade_commands,
	build_effective_upgrade_notes,
	build_project_upgrade_commands,
	format_update_command,
	format_effective_outcome,
	build_upgrade_shell_command,
	unique_upgrade_commands,
}

export type {
	ReleaseHold,
	VersionSnapshot,
	RunningBinary,
	VersionOutputExtras,
	UpstreamReport,
	UpstreamEffective,
	EffectiveUpgradeHint,
}
export { version_check_logic }
