import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kit_running_version } from './kit-running-version'

const make_directory = temporary_directory()
const VERSION = '1.3153.0'
const SCRIPT_GROUP = ['scripts', 'version'] as const
const INSTALL_PATH = ['node_modules', '@joshuafolkken', 'kit'] as const

// A package root holding `version` under `parts`, and the script directory a running module sits in.
function package_at(parts: ReadonlyArray<string>, version?: string): string {
	const root = path.join(make_directory('josh-kit-running-version-'), ...parts)
	const self_directory = path.join(root, ...SCRIPT_GROUP)

	mkdirSync(self_directory, { recursive: true })

	if (version !== undefined) {
		writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }))
	}

	return self_directory
}

function described_as(output: string | undefined): void {
	vi.spyOn(git_spawn_sync, 'read').mockReturnValue(output)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('kit_running_version.version_of', () => {
	it('adds the commits since the release in a kit checkout', () => {
		described_as(`v${VERSION}-12-g1234567`)

		expect(kit_running_version.version_of(package_at([], VERSION))).toBe(`v${VERSION}+12`)
	})

	it('adds no +0 right at a release', () => {
		described_as(`v${VERSION}-0-g1234567`)

		expect(kit_running_version.version_of(package_at([], VERSION))).toBe(`v${VERSION}`)
	})

	it('draws the version alone where git cannot describe the checkout', () => {
		described_as(undefined)

		expect(kit_running_version.version_of(package_at([], VERSION))).toBe(`v${VERSION}`)
	})

	it('draws the installed version alone in a consumer, never asking its git', () => {
		described_as(`v${VERSION}-12-g1234567`)

		expect(kit_running_version.version_of(package_at(INSTALL_PATH, VERSION))).toBe(`v${VERSION}`)
		expect(git_spawn_sync.read).not.toHaveBeenCalled()
	})

	it('reads no version where the package.json cannot be read', () => {
		expect(kit_running_version.version_of(package_at([]))).toBeUndefined()
	})

	it('reads the version this checkout runs when no directory is named', () => {
		expect(kit_running_version.version_of()).toMatch(/^v\d+\.\d+\.\d+/u)
	})
})
