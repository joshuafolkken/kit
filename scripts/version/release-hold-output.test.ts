import { describe, expect, it } from 'vitest'
import {
	version_check_logic,
	type ReleaseHold,
	type UpstreamReport,
	type VersionSnapshot,
} from './version-check-logic'
import { create_version_command_config } from './version-command-config'

// The release-age window binds *unpinned* resolution only. Measured on pnpm 11.22.0 with
// `minimum-release-age=1440` against a release published 3.5 h earlier:
//
//   pnpm add pkg@1.80.0  ->  1.80.0   (pnpm records a `minimumReleaseAgeExclude` entry)
//   pnpm add pkg         ->  1.78.0
//
// So the explanation belongs to the one peer-resolved target — an upstream's effective install
// (joshuafolkken/kit#698) — and the pinned `Run:` hint is never suppressed (joshuafolkken/kit#808).
const PACKAGE_NAME = '@joshuafolkken/kit'
const LATEST = '1.80.0'
const INSTALLABLE = '1.78.0'
const STALE = '1.70.0'
const DAY_MINUTES = 1440
const HOLD: ReleaseHold = { installable: INSTALLABLE, minimum_age_minutes: DAY_MINUTES }
const UPGRADE_COMMAND = 'pnpm add -g @joshuafolkken/app-kit@1.0.0'

const config = create_version_command_config({ package_name: PACKAGE_NAME })

function count_of(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1
}

function render_main(global_version: string): string {
	const snapshot: VersionSnapshot = {
		global_version,
		project_version: LATEST,
		latest: LATEST,
	}

	return version_check_logic.format_dual_version_output(snapshot, config)
}

function upstream_report(
	effective_version: string | undefined,
	hold: ReleaseHold | undefined,
): UpstreamReport {
	return {
		config,
		project_version: LATEST,
		latest: LATEST,
		...(hold !== undefined && { hold }),
		...(effective_version !== undefined && {
			effective: { version: effective_version, upgrade_command: UPGRADE_COMMAND },
		}),
	}
}

// No default for `hold`: a default parameter fires on an explicitly-passed `undefined`, so the
// degrade-to-previous cases would silently run with a hold attached.
function render_upstream(
	effective_version: string | undefined,
	hold: ReleaseHold | undefined,
): string {
	return version_check_logic
		.format_upstream_lines(upstream_report(effective_version, hold))
		.join('\n')
}

function render_held(effective_version: string | undefined): string {
	return render_upstream(effective_version, HOLD)
}

describe('release-age hold on a peer-resolved upstream install', () => {
	it('explains the hold instead of leaving a bare staleness marker', () => {
		const output = render_held(INSTALLABLE)

		expect(output).toContain('Held:')
		expect(output).toContain('minimum-release-age')
		expect(output).toContain(INSTALLABLE)
	})

	it('states what an unpinned resolve lands on, not that latest is uninstallable', () => {
		const output = render_held(INSTALLABLE)

		expect(output).toContain('unpinned resolve')
		expect(output).not.toContain('newest installable release')
	})

	it('keeps the staleness marker, since the install is genuinely behind latest', () => {
		expect(render_held(INSTALLABLE)).toContain(`⚠ → ${LATEST}`)
	})

	it('states the hold once', () => {
		expect(count_of(render_held(INSTALLABLE), 'Held:')).toBe(1)
	})

	it('says nothing extra for an install below what an unpinned resolve reaches', () => {
		expect(render_held(STALE)).not.toContain('Held:')
	})

	it('says nothing extra for an install already at latest', () => {
		expect(render_held(LATEST)).not.toContain('Held:')
	})

	// A target ahead of the newest aged release is still waiting on the same window.
	it('treats an install between the aged release and latest as held', () => {
		expect(render_held('1.79.5')).toContain('Held:')
	})
})

describe('release-age hold degrades to the previous report', () => {
	// An unresolvable hold is absent rather than empty, so "no hold" is the single degrade path.
	it('renders no note when no hold was resolved at all', () => {
		expect(render_upstream(INSTALLABLE, undefined)).not.toContain('Held:')
	})

	// The main package's targets are upgraded by explicitly pinned commands, which the window does not
	// block, so its section carries no hold explanation at all.
	it('leaves the main package section unannotated', () => {
		expect(render_main(INSTALLABLE)).not.toContain('Held:')
	})
})

// The pinned command installs even inside the window, so hiding it would hide the one command that
// upgrades the user.
describe('the upgrade hint is never suppressed by a hold', () => {
	it('prints the hint for a held upstream install', () => {
		expect(
			version_check_logic.build_effective_upgrade_commands(upstream_report(INSTALLABLE, HOLD)),
		).toStrictEqual([UPGRADE_COMMAND])
	})

	it('prints the hint for the main package regardless of any window', () => {
		expect(render_main(INSTALLABLE)).toContain('Run:')
	})
})
