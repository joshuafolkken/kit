import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VersionCommandConfig } from './version-command-config'
import { version_commands } from './version-commands'

// version-remote is deliberately left unmocked here (unlike version-commands.test.ts) so the real
// `require_endpoint` guard runs and we verify read_snapshot surfaces its descriptive error rather
// than an opaque `gh api undefined` failure. version-targets is mocked to keep the read hermetic.
vi.mock('./version-targets', () => ({
	version_targets: { read_global_version: vi.fn(), read_project_version: vi.fn() },
}))

const KIT_PACKAGE = '@joshuafolkken/kit'
const NO_ENDPOINT_ERROR = /Could not derive a versions endpoint for @joshuafolkken\/kit/u
const BLANK_SPACES = 3

// A hand-built config carrying a blank endpoint stands in for a config produced by an old kit
// (before endpoint derivation, kit#632) — the game-kit#395 scenario that motivated this guard.
function config_with_endpoint(versions_endpoint: string): VersionCommandConfig {
	return {
		package_name: KIT_PACKAGE,
		versions_endpoint,
		fix_gh_packages_path: 'node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts',
		upstreams: [],
	}
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('version_commands.read_snapshot endpoint guard', () => {
	it('raises the descriptive endpoint error when the endpoint is empty', () => {
		expect(() => version_commands.read_snapshot(config_with_endpoint(''))).toThrow(
			NO_ENDPOINT_ERROR,
		)
	})

	it('raises the descriptive endpoint error when the endpoint is whitespace-only', () => {
		const blank_spaces = ' '.repeat(BLANK_SPACES)

		expect(() => version_commands.read_snapshot(config_with_endpoint(blank_spaces))).toThrow(
			NO_ENDPOINT_ERROR,
		)
	})
})
