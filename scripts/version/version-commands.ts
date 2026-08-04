import { execaSync } from 'execa'
import { running_binary } from './running-binary'
import type { InstalledVersions } from './upgrade-command-guard'
import {
	version_check_logic,
	type RunningBinary,
	type UpstreamEffective,
	type UpstreamReport,
	type VersionOutputExtras,
	type VersionSnapshot,
} from './version-check-logic'
import type {
	UpstreamHookContext,
	UpstreamVersionConfig,
	VersionCommandConfig,
} from './version-command-config'
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
		latest: fetch_latest_version(config.versions_endpoint, config.package_name),
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

// Resolve the upstream's effective (running-relative) install from the consumer's opt-in hooks, or
// undefined when the consumer supplies neither (e.g. kit, which has no upstream). Both hooks are
// required together and receive `context` (the downstream package's already-fetched latest) so the
// global upgrade command can reuse kit's single fetch instead of resolving `latest` a second time.
function build_upstream_effective(
	upstream: UpstreamVersionConfig,
	context: UpstreamHookContext,
): UpstreamEffective | undefined {
	const { resolve_effective_version, resolve_global_upgrade_command } = upstream
	if (resolve_effective_version === undefined) return undefined
	if (resolve_global_upgrade_command === undefined) return undefined

	return {
		version: resolve_effective_version(context),
		upgrade_command: resolve_global_upgrade_command(context),
	}
}

// The globally-resolved versions kit already knows for one upstream: the primary package's global
// install (what a `pnpm add -g <primary>@<v>` command would target) and the upstream's own effective
// install. Attached to the report only when the consumer declared its global upgrade command
// pin-only, so the no-op guard can prove a command that pins these exact versions is dead (#697).
function build_installed_versions(
	report: UpstreamReport,
	config: VersionCommandConfig,
	snapshot: VersionSnapshot,
): InstalledVersions {
	return new Map([
		[config.package_name, snapshot.global_version],
		[report.config.package_name, report.effective?.version],
	])
}

// Attach the effective install and, when the consumer declared its global command pin-only, the
// installed versions the no-op guard needs. Mutates the report in place so the optional fields stay
// absent for upstreams without hooks (`exactOptionalPropertyTypes`).
function attach_upstream_effective(
	report: UpstreamReport,
	config: VersionCommandConfig,
	snapshot: VersionSnapshot,
	upstream: UpstreamVersionConfig,
): void {
	const context: UpstreamHookContext = { latest: snapshot.latest, upstream_latest: report.latest }
	const effective = build_upstream_effective(upstream, context)
	if (effective === undefined) return

	report.effective = effective
	if (upstream.is_global_upgrade_command_pinned !== true) return

	report.installed_versions = build_installed_versions(report, config, snapshot)
}

// Read one upstream's project-installed and latest versions, plus the optional effective/global
// install when the consumer opts in. Absent the hooks, the report keeps its project/latest-only shape.
function read_upstream_report(
	upstream: UpstreamVersionConfig,
	config: VersionCommandConfig,
	snapshot: VersionSnapshot,
): UpstreamReport {
	const report: UpstreamReport = {
		config: upstream,
		project_version: version_targets.read_project_version(process.cwd(), upstream.package_name),
		latest: fetch_latest_version(upstream.versions_endpoint, upstream.package_name),
	}

	attach_upstream_effective(report, config, snapshot, upstream)

	return report
}

// Read the reports for the configured upstream chain, preserving the configured (nearest-first)
// order. Empty when the consumer declares no upstreams (e.g. kit itself). `snapshot` is the primary
// package's already-read state (from `read_snapshot`): its `latest` is threaded into each upstream's
// hooks so a consumer never re-fetches it, and its `global_version` feeds the no-op guard.
function read_upstream_reports(
	config: VersionCommandConfig,
	snapshot: VersionSnapshot,
): Array<UpstreamReport> {
	return config.upstreams.map((upstream) => read_upstream_report(upstream, config, snapshot))
}

// The `version` (show) command for any configured package: print the dual/offline report with
// staleness markers, upstream sections, upgrade hints, and the running-binary/warning extras.
function run_check(config: VersionCommandConfig): void {
	const snapshot = read_snapshot(config)
	const upstream_reports = read_upstream_reports(config, snapshot)

	console.info(
		version_check_logic.format_dual_version_output(
			snapshot,
			config,
			build_extras(config),
			upstream_reports,
		),
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

// What to print when nothing can be upgraded: either everything is current, or a stale effective
// upstream's global command provably cannot change it and the explanation says so (#697).
function build_idle_message(reports: ReadonlyArray<UpstreamReport>): string {
	const notes = version_check_logic.build_upstream_upgrade_notes(reports)
	if (notes.length === 0) return ALREADY_UP_TO_DATE

	return notes.join('\n')
}

// Re-read one upstream's effective install after the upgrade ran and describe what changed, or
// nothing when it reached the latest (success needs no explanation). Gated on the global command
// having actually been emitted: a suppressed no-op command never ran, so reporting that it "did not
// change" the install would blame a command the user was never offered.
function describe_effective_outcome(
	upstream: UpstreamVersionConfig,
	report: UpstreamReport | undefined,
	snapshot: VersionSnapshot,
): Array<string> {
	const { resolve_effective_version } = upstream
	if (resolve_effective_version === undefined || report === undefined) return []
	if (version_check_logic.build_effective_upgrade_commands(report).length === 0) return []

	const after = resolve_effective_version({
		latest: snapshot.latest,
		upstream_latest: report.latest,
	})
	if (after === report.latest) return []

	return [version_check_logic.format_effective_outcome(report, after)]
}

// After the upgrade commands ran, report every effective upstream that did not reach its latest, so
// `version:upgrade` states the outcome itself instead of leaving the next `version` to repeat the
// same warning. Reports and configured upstreams share an index — `read_upstream_reports` maps over
// `config.upstreams` in order — which is how each report is paired back with its hooks.
function report_effective_outcomes(
	config: VersionCommandConfig,
	snapshot: VersionSnapshot,
	reports: ReadonlyArray<UpstreamReport>,
): void {
	const lines = config.upstreams.flatMap((upstream, index) =>
		describe_effective_outcome(upstream, reports[index], snapshot),
	)
	if (lines.length > 0) console.info(lines.join('\n'))
}

// The `version:upgrade` command for any configured package: upgrade whichever of global/project
// are stale, plus any stale upstream project dependencies (each respecting the fix-gh-packages
// lockfile repair). Returns the process exit code.
function run_upgrade(config: VersionCommandConfig): number {
	const snapshot = read_snapshot(config)
	const reports = read_upstream_reports(config, snapshot)
	const commands = version_check_logic.unique_upgrade_commands([
		...version_check_logic.build_dual_upgrade_commands(snapshot, config),
		...version_check_logic.build_upstream_upgrade_commands(reports),
	])

	if (commands.length === 0) {
		console.info(build_idle_message(reports))

		return 0
	}

	const exit_code = run_all_upgrade_commands(commands)

	report_effective_outcomes(config, snapshot, reports)

	return exit_code
}

const version_commands = {
	read_snapshot,
	read_upstream_reports,
	build_extras,
	run_check,
	run_upgrade,
	run_upgrade_command,
	run_all_upgrade_commands,
}

export { version_commands }
