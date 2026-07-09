import { describe, expect, it } from 'vitest'
import {
	version_check_logic,
	type UpstreamEffective,
	type UpstreamReport,
	type VersionSnapshot,
} from './version-check-logic'
import { create_version_command_config } from './version-command-config'

const MAIN_PACKAGE = '@joshuafolkken/game-kit'
const MAIN_LATEST = '2.0.0'
const UPSTREAM_PACKAGE = '@joshuafolkken/app-kit'
const KIT_PACKAGE = '@joshuafolkken/kit'
const UPSTREAM_LATEST = '1.5.0'
const UPSTREAM_STALE = '1.4.0'
const EFFECTIVE_STALE = '1.3.0'
const ADD_LOCAL = 'pnpm add -D'
const ADD_GLOBAL = 'pnpm add -g'
const NOT_INSTALLED_TEXT = 'not installed'
// The consumer's global upgrade command routes through the downstream CLI (the running global
// game-kit), not a bare upstream global install — that is what actually bumps the bundled upstream.
const GLOBAL_UPGRADE_COMMAND = `${ADD_GLOBAL} ${MAIN_PACKAGE}@${MAIN_LATEST}`

const MAIN_CONFIG = create_version_command_config({ package_name: MAIN_PACKAGE })
const UPSTREAM_CONFIG = create_version_command_config({ package_name: UPSTREAM_PACKAGE })

function upstream_report(project_version: string | undefined): UpstreamReport {
	return { config: UPSTREAM_CONFIG, project_version, latest: UPSTREAM_LATEST }
}

function effective_at(version: string | undefined): UpstreamEffective {
	return { version, upgrade_command: GLOBAL_UPGRADE_COMMAND }
}

function report_with_effective(
	project_version: string | undefined,
	effective_version: string | undefined,
): UpstreamReport {
	return { ...upstream_report(project_version), effective: effective_at(effective_version) }
}

function up_to_date_snapshot(latest: string): VersionSnapshot {
	return { global_version: latest, project_version: latest, latest }
}

describe('version_check_logic.format_upstream_lines', () => {
	it('renders the upstream package name with project and latest lines', () => {
		const lines = version_check_logic.format_upstream_lines(upstream_report(UPSTREAM_LATEST))

		expect(lines).toContain(UPSTREAM_PACKAGE)
		expect(lines.join('\n')).toContain('Project:')
		expect(lines.join('\n')).toContain(`Latest:  ${UPSTREAM_LATEST}`)
	})

	it('marks a stale upstream with the staleness arrow', () => {
		const result = version_check_logic.format_upstream_lines(upstream_report(UPSTREAM_STALE))

		expect(result.join('\n')).toContain(`⚠ → ${UPSTREAM_LATEST}`)
	})

	it(`shows "${NOT_INSTALLED_TEXT}" for an upstream missing from the project`, () => {
		const result = version_check_logic.format_upstream_lines(upstream_report(undefined))

		expect(result.join('\n')).toContain(NOT_INSTALLED_TEXT)
	})
})

describe('version_check_logic.build_upstream_upgrade_commands', () => {
	it('builds a project-scope command with lockfile repair for a stale upstream', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			upstream_report(UPSTREAM_STALE),
		])

		expect(result).toHaveLength(1)
		expect(result[0]).toContain(`${ADD_LOCAL} ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`)
		// The repair always runs kit's single fix-gh-packages.ts, not the upstream's own copy.
		expect(result[0]).toContain(`node_modules/${KIT_PACKAGE}/scripts/fix-gh-packages.ts`)
	})

	it('never builds a global command for upstreams', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			upstream_report(UPSTREAM_STALE),
		])

		expect(result[0]).not.toContain(ADD_GLOBAL)
	})

	it('skips up-to-date and not-installed upstreams', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			upstream_report(UPSTREAM_LATEST),
			upstream_report(undefined),
		])

		expect(result).toStrictEqual([])
	})
})

describe('version_check_logic.format_upstream_lines effective/global line', () => {
	it('omits the Global line when the report has no effective install', () => {
		const lines = version_check_logic.format_upstream_lines(upstream_report(UPSTREAM_LATEST))

		expect(lines.join('\n')).not.toContain('Global:')
	})

	it('renders the Global line with the effective version when present', () => {
		const lines = version_check_logic.format_upstream_lines(
			report_with_effective(UPSTREAM_LATEST, UPSTREAM_LATEST),
		)

		expect(lines.join('\n')).toContain(`Global:  ${UPSTREAM_LATEST}`)
	})

	it('marks a stale effective install with the staleness arrow', () => {
		const lines = version_check_logic.format_upstream_lines(
			report_with_effective(UPSTREAM_LATEST, EFFECTIVE_STALE),
		)

		expect(lines.join('\n')).toContain(`Global:  ${EFFECTIVE_STALE}`)
		expect(lines.join('\n')).toContain(`⚠ → ${UPSTREAM_LATEST}`)
	})

	it(`shows "${NOT_INSTALLED_TEXT}" on the Global line when the effective install is unresolved`, () => {
		const lines = version_check_logic.format_upstream_lines(
			report_with_effective(UPSTREAM_LATEST, undefined),
		)
		const global_line = lines.find((line) => line.includes('Global:'))

		expect(global_line).toContain(NOT_INSTALLED_TEXT)
	})
})

describe('version_check_logic.build_upstream_upgrade_commands effective/global', () => {
	it('emits the consumer global command for a stale effective install', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			report_with_effective(UPSTREAM_LATEST, EFFECTIVE_STALE),
		])

		expect(result).toStrictEqual([GLOBAL_UPGRADE_COMMAND])
	})

	it('omits the global command when the effective install is up to date', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			report_with_effective(UPSTREAM_LATEST, UPSTREAM_LATEST),
		])

		expect(result).toStrictEqual([])
	})

	it('omits the global command when the effective install is unresolved', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			report_with_effective(UPSTREAM_LATEST, undefined),
		])

		expect(result).toStrictEqual([])
	})

	it('emits the global command before the project command when both are stale', () => {
		const result = version_check_logic.build_upstream_upgrade_commands([
			report_with_effective(UPSTREAM_STALE, EFFECTIVE_STALE),
		])

		expect(result[0]).toBe(GLOBAL_UPGRADE_COMMAND)
		expect(result[1]).toContain(`${ADD_LOCAL} ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`)
	})
})

describe('version_check_logic.format_dual_version_output effective/global', () => {
	it('renders the effective Global line and its upgrade hint in the full report', () => {
		const result = version_check_logic.format_dual_version_output(
			up_to_date_snapshot(MAIN_LATEST),
			MAIN_CONFIG,
			{},
			[report_with_effective(UPSTREAM_LATEST, EFFECTIVE_STALE)],
		)

		expect(result).toContain(`Global:  ${EFFECTIVE_STALE}`)
		expect(result).toContain(`Run: ${GLOBAL_UPGRADE_COMMAND}`)
	})
})

describe('version_check_logic.format_dual_version_output upstream sections', () => {
	it('renders the upstream section after the main report with its run hint', () => {
		const result = version_check_logic.format_dual_version_output(
			up_to_date_snapshot(MAIN_LATEST),
			MAIN_CONFIG,
			{},
			[upstream_report(UPSTREAM_STALE)],
		)

		expect(result.indexOf(UPSTREAM_PACKAGE)).toBeGreaterThan(result.indexOf(MAIN_PACKAGE))
		expect(result).toContain(`Run: ${ADD_LOCAL} ${UPSTREAM_PACKAGE}@${UPSTREAM_LATEST}`)
	})

	it('omits the upstream run hint when the upstream is up to date', () => {
		const result = version_check_logic.format_dual_version_output(
			up_to_date_snapshot(MAIN_LATEST),
			MAIN_CONFIG,
			{},
			[upstream_report(UPSTREAM_LATEST)],
		)

		expect(result).toContain(UPSTREAM_PACKAGE)
		expect(result).not.toContain('Run:')
	})
})
