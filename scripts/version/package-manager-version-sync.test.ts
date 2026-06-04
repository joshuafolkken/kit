import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { sync } from '#scripts/sync/sync'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latest_corepack } from './latest-corepack'

const DRIFTED = `{\n\t"name": "demo",\n\t"packageManager": "pnpm@11.5.0+sha512.abc",\n\t"devEngines": {\n\t\t"packageManager": {\n\t\t\t"name": "pnpm",\n\t\t\t"version": ">=11.0.0-0",\n\t\t\t"onFail": "error"\n\t\t}\n\t}\n}\n`
const ALIGNED = DRIFTED.replace('>=11.0.0-0', '11.5.0')

let work_directory = ''
let package_json_path = ''

function read_manifest(): string {
	return readFileSync(package_json_path, 'utf8')
}

beforeEach(() => {
	work_directory = mkdtempSync(path.join(tmpdir(), 'pm-version-sync-'))
	package_json_path = path.join(work_directory, 'package.json')
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => {
	rmSync(work_directory, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('sync.sync_package_manager_version', () => {
	it('repairs a drifted devEngines version to match the packageManager pin', () => {
		writeFileSync(package_json_path, DRIFTED)
		sync.sync_package_manager_version(package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('leaves an already-aligned manifest untouched during sync', () => {
		writeFileSync(package_json_path, ALIGNED)
		sync.sync_package_manager_version(package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('does nothing when the manifest is missing', () => {
		expect(() => {
			sync.sync_package_manager_version(package_json_path)
		}).not.toThrow()
	})
})

describe('latest_corepack.sync_development_engines_after_bump', () => {
	it('rewrites a drifted devEngines version to the packageManager pin', () => {
		writeFileSync(package_json_path, DRIFTED)
		latest_corepack.sync_development_engines_after_bump(package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})

	it('leaves an already-aligned manifest untouched after a bump', () => {
		writeFileSync(package_json_path, ALIGNED)
		latest_corepack.sync_development_engines_after_bump(package_json_path)

		expect(read_manifest()).toBe(ALIGNED)
	})
})
