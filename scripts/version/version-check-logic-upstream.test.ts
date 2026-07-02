import { describe, expect, it } from 'vitest'
import {
	version_check_logic,
	type UpstreamReport,
	type VersionSnapshot,
} from './version-check-logic'
import { create_version_command_config } from './version-command-config'

const MAIN_PACKAGE = '@joshuafolkken/game-kit'
const MAIN_LATEST = '2.0.0'
const UPSTREAM_PACKAGE = '@joshuafolkken/app-kit'
const UPSTREAM_LATEST = '1.5.0'
const UPSTREAM_STALE = '1.4.0'
const ADD_LOCAL = 'pnpm add -D'
const ADD_GLOBAL = 'pnpm add -g'
const NOT_INSTALLED_TEXT = 'not installed'

const MAIN_CONFIG = create_version_command_config({ package_name: MAIN_PACKAGE })
const UPSTREAM_CONFIG = create_version_command_config({ package_name: UPSTREAM_PACKAGE })

function upstream_report(project_version: string | undefined): UpstreamReport {
	return { config: UPSTREAM_CONFIG, project_version, latest: UPSTREAM_LATEST }
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
		expect(result[0]).toContain(`node_modules/${UPSTREAM_PACKAGE}/scripts/fix-gh-packages.ts`)
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
