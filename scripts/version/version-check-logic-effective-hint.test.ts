import { describe, expect, it } from 'vitest'
import {
	version_check_logic,
	type UpstreamReport,
	type VersionSnapshot,
} from './version-check-logic'
import { create_version_command_config } from './version-command-config'

const MAIN_PACKAGE = '@joshuafolkken/game-kit'
const MAIN_LATEST = '2.0.0'
const MAIN_STALE = '1.9.0'
const UPSTREAM_PACKAGE = '@joshuafolkken/app-kit'
const SECOND_UPSTREAM_PACKAGE = '@joshuafolkken/kit'
const UPSTREAM_LATEST = '1.5.0'
const EFFECTIVE_STALE = '1.3.0'
const EFFECTIVE_ADVANCED = '1.4.0'
// The consumer's global command pins the running downstream CLI, which is what bundles the upstream.
const PINNED_COMMAND = `pnpm add -g ${MAIN_PACKAGE}@${MAIN_LATEST}`
// A command that forces a fresh resolve changes the graph even though its pin is already installed.
const FRESH_RESOLVE_COMMAND = `pnpm remove -g ${MAIN_PACKAGE} && ${PINNED_COMMAND}`

const MAIN_CONFIG = create_version_command_config({ package_name: MAIN_PACKAGE })
const UPSTREAM_CONFIG = create_version_command_config({ package_name: UPSTREAM_PACKAGE })
const SECOND_UPSTREAM_CONFIG = create_version_command_config({
	package_name: SECOND_UPSTREAM_PACKAGE,
})

// The primary CLI is already at its own latest — the state in which a pin-only global command has
// nothing left to install and so cannot clear the upstream staleness it was emitted for (#697).
const PRIMARY_AT_LATEST = new Map([[MAIN_PACKAGE, MAIN_LATEST]])

function stale_effective_report(
	upgrade_command: string,
	installed_versions?: Map<string, string | undefined>,
): UpstreamReport {
	const report: UpstreamReport = {
		config: UPSTREAM_CONFIG,
		project_version: UPSTREAM_LATEST,
		latest: UPSTREAM_LATEST,
		effective: { version: EFFECTIVE_STALE, upgrade_command },
	}
	if (installed_versions !== undefined) report.installed_versions = installed_versions

	return report
}

function up_to_date_snapshot(latest: string): VersionSnapshot {
	return { global_version: latest, project_version: latest, latest }
}

describe('version_check_logic.build_effective_upgrade_commands no-op guard', () => {
	it('suppresses the command when every version it pins is already installed', () => {
		const report = stale_effective_report(PINNED_COMMAND, PRIMARY_AT_LATEST)

		expect(version_check_logic.build_effective_upgrade_commands(report)).toStrictEqual([])
	})

	it('keeps the command when the consumer did not declare it pin-only', () => {
		const report = stale_effective_report(PINNED_COMMAND)

		expect(version_check_logic.build_effective_upgrade_commands(report)).toStrictEqual([
			PINNED_COMMAND,
		])
	})

	it('keeps a fresh-resolve command whose pin is already installed', () => {
		const report = stale_effective_report(FRESH_RESOLVE_COMMAND)

		expect(version_check_logic.build_effective_upgrade_commands(report)).toStrictEqual([
			FRESH_RESOLVE_COMMAND,
		])
	})

	it('keeps the command when the pinned version is still ahead of the installed one', () => {
		const installed = new Map([[MAIN_PACKAGE, MAIN_STALE]])
		const report = stale_effective_report(PINNED_COMMAND, installed)

		expect(version_check_logic.build_effective_upgrade_commands(report)).toStrictEqual([
			PINNED_COMMAND,
		])
	})
})

describe('version_check_logic.build_effective_upgrade_notes', () => {
	it('explains the suppressed hint instead of leaving the staleness unaccounted for', () => {
		const report = stale_effective_report(PINNED_COMMAND, PRIMARY_AT_LATEST)
		const notes = version_check_logic.build_effective_upgrade_notes(report)

		expect(notes).toHaveLength(1)
		expect(notes[0]).toContain(PINNED_COMMAND)
		expect(notes[0]).toContain(UPSTREAM_PACKAGE)
		expect(notes[0]).toContain(UPSTREAM_LATEST)
	})

	it('emits no note when the command is still able to change the effective install', () => {
		const report = stale_effective_report(PINNED_COMMAND)

		expect(version_check_logic.build_effective_upgrade_notes(report)).toStrictEqual([])
	})
})

describe('version_check_logic.format_dual_version_output with a dead global command', () => {
	it('replaces the Run hint with the explanation in the rendered report', () => {
		const result = version_check_logic.format_dual_version_output(
			up_to_date_snapshot(MAIN_LATEST),
			MAIN_CONFIG,
			{},
			[stale_effective_report(PINNED_COMMAND, PRIMARY_AT_LATEST)],
		)

		expect(result).toContain(`Global:  ${EFFECTIVE_STALE}`)
		expect(result).not.toContain('Run:')
		expect(result).toContain(`Note: \`${PINNED_COMMAND}\``)
	})
})

describe('version_check_logic.unique_upgrade_commands', () => {
	it('drops repeated commands while preserving first-seen order', () => {
		const result = version_check_logic.unique_upgrade_commands(['a', 'b', 'a', 'c', 'b'])

		expect(result).toStrictEqual(['a', 'b', 'c'])
	})
})

describe('version_check_logic.format_dual_version_output hint de-duplication', () => {
	it('prints an identical global command once even when several upstreams return it', () => {
		const second: UpstreamReport = {
			...stale_effective_report(PINNED_COMMAND),
			config: SECOND_UPSTREAM_CONFIG,
		}
		const result = version_check_logic.format_dual_version_output(
			up_to_date_snapshot(MAIN_LATEST),
			MAIN_CONFIG,
			{},
			[stale_effective_report(PINNED_COMMAND), second],
		)

		expect(result.split(`Run: ${PINNED_COMMAND}`)).toHaveLength(2)
	})
})

describe('version_check_logic.format_effective_outcome', () => {
	it('reports an unchanged effective install as the command having done nothing', () => {
		const report = stale_effective_report(PINNED_COMMAND)
		const line = version_check_logic.format_effective_outcome(report, EFFECTIVE_STALE)

		expect(line).toContain(`still ${EFFECTIVE_STALE}`)
		expect(line).toContain('did not change it')
	})

	it('reports an advance that still trails latest as progress, not a failure', () => {
		const report = stale_effective_report(PINNED_COMMAND)
		const line = version_check_logic.format_effective_outcome(report, EFFECTIVE_ADVANCED)

		expect(line).toContain(`${EFFECTIVE_STALE} → ${EFFECTIVE_ADVANCED}`)
		expect(line).toContain(`still behind latest ${UPSTREAM_LATEST}`)
	})
})
