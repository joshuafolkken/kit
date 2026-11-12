import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { sync } from '#scripts/sync/sync'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'
import { build_package_manager_manifest } from './package-manager-manifest-fixture'

const make_directory = temporary_directory()

const RANGE_VERSION = '>=11.0.0-0'
// The whole pin, integrity suffix included: pnpm only treats the two fields as
// an exact match when the strings are identical.
const PINNED_VERSION = '11.5.0+sha512.abc'
const BARE_VERSION = '11.5.0'
const PM_PIN = `pnpm@${PINNED_VERSION}`

function build_manifest(development_engines_version: string): string {
	return build_package_manager_manifest(PM_PIN, development_engines_version)
}

const DRIFTED = build_manifest(RANGE_VERSION)
const ALIGNED = build_manifest(PINNED_VERSION)
const BARE_DRIFTED = build_manifest(BARE_VERSION)

const ctx = { work_directory: '', package_json_path: '' }

function read_manifest(): string {
	return readFileSync(ctx.package_json_path, 'utf8')
}

beforeEach(() => {
	ctx.work_directory = make_directory('pm-version-sync-')
	ctx.package_json_path = path.join(ctx.work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('sync.sync_package_manager_version', () => {
	it('repairs a drifted devEngines version to match the packageManager pin', () => {
		writeFileSync(ctx.package_json_path, DRIFTED)
		sync.sync_package_manager_version(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('repairs a manifest whose devEngines version dropped the integrity suffix', () => {
		writeFileSync(ctx.package_json_path, BARE_DRIFTED)
		sync.sync_package_manager_version(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('leaves an already-aligned manifest untouched during sync', () => {
		writeFileSync(ctx.package_json_path, ALIGNED)
		sync.sync_package_manager_version(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_package_manager_version(ctx.package_json_path)
		}).not.toThrow()
	})
})

describe('latest_corepack.sync_development_engines', () => {
	it('rewrites a drifted devEngines version to the packageManager pin', () => {
		writeFileSync(ctx.package_json_path, DRIFTED)
		latest_corepack.sync_development_engines(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('restores the integrity suffix a previous bump left off', () => {
		writeFileSync(ctx.package_json_path, BARE_DRIFTED)
		latest_corepack.sync_development_engines(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('leaves an already-aligned manifest untouched after a bump', () => {
		writeFileSync(ctx.package_json_path, ALIGNED)
		latest_corepack.sync_development_engines(ctx.package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})
})
