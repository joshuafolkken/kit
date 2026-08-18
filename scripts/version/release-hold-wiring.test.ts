import { beforeEach, describe, expect, it, vi } from 'vitest'
import { release_age } from './release-age'
import {
	CHAINED_CONFIG_WITH_EFFECTIVE,
	EFFECTIVE_STALE,
	MAIN_SNAPSHOT,
	UPSTREAM_LATEST,
	version_chain_fixture,
} from './version-chain-fixture'
import { version_commands } from './version-commands'
import { fetch_release_times } from './version-remote'

vi.mock('execa', () => ({ execaSync: vi.fn() }))
vi.mock('./version-remote', () => ({
	fetch_latest_version: vi.fn(),
	fetch_release_times: vi.fn(),
}))
vi.mock('./version-targets', () => ({
	version_targets: { read_global_version: vi.fn(), read_project_version: vi.fn() },
}))

// The wiring between the report and the release-age lookup. Without a test here, reverting the
// `is_hold_wanted` argument or the staleness gate leaves every rendering test green while the
// `Held:` line silently disappears (joshuafolkken/kit#808).
const DAY_MINUTES = 1440
const AGED = '1.4.0'
// `latest` must itself be inside the window for a hold to exist, so it is stamped relative to now.
const HOUR_MS = 3_600_000
const RELEASE_TIMES = Object.fromEntries([
	[UPSTREAM_LATEST, new Date(Date.now() - HOUR_MS).toISOString()],
	[AGED, new Date(Date.now() - 72 * HOUR_MS).toISOString()],
])

const mocked_fetch_times = vi.mocked(fetch_release_times)

function read_reports(
	is_hold_wanted: boolean,
): ReturnType<typeof version_commands.read_upstream_reports> {
	return version_commands.read_upstream_reports(
		CHAINED_CONFIG_WITH_EFFECTIVE,
		MAIN_SNAPSHOT,
		is_hold_wanted,
	)
}

function arrange(window_minutes: number): void {
	version_chain_fixture.arrange_chain_versions(UPSTREAM_LATEST)
	vi.spyOn(release_age, 'read_nearest_minimum_release_age').mockReturnValue(window_minutes)
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
	mocked_fetch_times.mockReturnValue(RELEASE_TIMES)
})

describe('release hold wiring', () => {
	it('attaches the resolved installable release to a stale upstream report', () => {
		arrange(DAY_MINUTES)

		expect(read_reports(true)[0]?.hold?.installable).toBe(AGED)
	})

	it('carries the configured window onto the report', () => {
		arrange(DAY_MINUTES)

		expect(read_reports(true)[0]?.hold?.minimum_age_minutes).toBe(DAY_MINUTES)
	})

	it('resolves the window by walking up from the working directory', () => {
		arrange(DAY_MINUTES)
		const read_window = vi.spyOn(release_age, 'read_nearest_minimum_release_age')

		read_reports(true)

		expect(read_window).toHaveBeenCalledWith(process.cwd())
	})
})

// Each skip is a saved registry round trip, and none of them can hide a hold that matters.
describe('release hold lookup is skipped when it cannot matter', () => {
	it('skips the lookup when no window is configured', () => {
		arrange(0)

		expect(read_reports(true)[0]?.hold).toBeUndefined()
		expect(mocked_fetch_times).not.toHaveBeenCalled()
	})

	// `version:upgrade` never reads the hold, so it must not pay for the extra round trip.
	it('skips the lookup on the upgrade path', () => {
		arrange(DAY_MINUTES)

		expect(read_reports(false)[0]?.hold).toBeUndefined()
		expect(mocked_fetch_times).not.toHaveBeenCalled()
	})
})

describe('release hold lookup covers a stale effective install', () => {
	it('runs the lookup when the effective install is behind latest', () => {
		version_chain_fixture.arrange_chain_versions(UPSTREAM_LATEST)
		vi.spyOn(release_age, 'read_nearest_minimum_release_age').mockReturnValue(DAY_MINUTES)
		read_reports(true)

		expect(mocked_fetch_times).toHaveBeenCalledTimes(1)
	})

	it('reports the stale effective install the hold explains', () => {
		arrange(DAY_MINUTES)

		expect(read_reports(true)[0]?.effective?.version).toBe(EFFECTIVE_STALE)
	})
})

// The production call site. Without this, deleting the `true` argument in `run_check` removes every
// `Held:` line while the rest of the suite stays green — the wiring tests above drive
// `read_upstream_reports` directly and would not notice (joshuafolkken/kit#808).
describe('run_check requests the release hold', () => {
	// The effective install must sit at the newest aged release for a hold to exist, so it is pinned
	// through the consumer hooks rather than taken from the shared arrangement.
	const held_config = version_chain_fixture.config_with_context_hooks({
		resolve_effective_version: () => AGED,
		resolve_global_upgrade_command: () => 'pnpm add -g @joshuafolkken/app-kit@2.0.0',
	})

	function run_and_capture(): string {
		version_chain_fixture.arrange_chain_versions(UPSTREAM_LATEST)
		vi.spyOn(release_age, 'read_nearest_minimum_release_age').mockReturnValue(DAY_MINUTES)
		const printed: Array<string> = []

		vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
			if (typeof line === 'string') printed.push(line)
		})

		version_commands.run_check(held_config)

		return printed.join('\n')
	}

	it('prints the hold explanation for a held effective install', () => {
		expect(run_and_capture()).toContain('minimum-release-age window')
	})

	it('fetches the publish timestamps it needs to do so', () => {
		run_and_capture()

		expect(mocked_fetch_times).toHaveBeenCalled()
	})
})
