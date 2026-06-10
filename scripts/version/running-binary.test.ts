import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { running_binary } from './running-binary'

// This test file lives in scripts/version/, the same depth as the runtime scripts, so walking up
// two levels lands on the kit package root — letting us exercise the real resolution.
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const SEMVER_PATTERN = /^\d+\.\d+\.\d+/u
const SCRIPT_DIR = '/pkg/scripts/version'

describe('running_binary.resolve_self_package_path', () => {
	it('resolves package.json two levels above the script directory', () => {
		const resolved = running_binary.resolve_self_package_path(SCRIPT_DIR)

		expect(resolved).toBe(path.join('/pkg', 'package.json'))
	})
})

describe('running_binary.running_package_directory', () => {
	it('resolves the package root two levels above the script directory', () => {
		const resolved = running_binary.running_package_directory(SCRIPT_DIR)

		expect(resolved).toBe(path.resolve('/pkg'))
	})
})

describe('running_binary.read_running_version', () => {
	it("reads the running binary's own declared version", () => {
		const version = running_binary.read_running_version(SELF_DIR)

		expect(version).toMatch(SEMVER_PATTERN)
	})

	it('returns undefined when no package.json exists above the directory', () => {
		const version = running_binary.read_running_version('/nonexistent/scripts/version')

		expect(version).toBeUndefined()
	})
})
