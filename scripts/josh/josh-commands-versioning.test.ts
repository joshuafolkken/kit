import { describe, expect, it } from 'vitest'
import { VERSIONING_COMMANDS } from './josh-commands-versioning'

const VERSION_NOT_DEFINED = 'version command not defined'

// joshuafolkken/kit#1928 folded the old `version:upgrade` command into a `--upgrade` flag on
// `version`, so the version surface is one command again.
describe('VERSIONING_COMMANDS version', () => {
	it('runs the version-check script that also serves --upgrade', () => {
		const cmd = VERSIONING_COMMANDS['version']
		if (!cmd) throw new Error(VERSION_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/version-check.ts')
	})

	it('documents the --upgrade flag in its description', () => {
		const cmd = VERSIONING_COMMANDS['version']
		if (!cmd) throw new Error(VERSION_NOT_DEFINED)

		expect(cmd.description).toContain('--upgrade')
	})
})

const RANGES_NOT_DEFINED = 'ranges command not defined'

describe('VERSIONING_COMMANDS ranges', () => {
	it('runs the guard that checks every published dependency range', () => {
		const cmd = VERSIONING_COMMANDS['ranges']
		if (!cmd) throw new Error(RANGES_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/publishable-range-check.ts')
	})

	it('is listed under Versioning so it appears beside bump in the command help', () => {
		const cmd = VERSIONING_COMMANDS['ranges']
		if (!cmd) throw new Error(RANGES_NOT_DEFINED)

		expect(cmd.category).toBe('Versioning')
	})
})

const RELEASE_NOT_DEFINED = 'release command not defined'

describe('VERSIONING_COMMANDS release', () => {
	it('runs the one command that decides a version from main history', () => {
		const cmd = VERSIONING_COMMANDS['release']
		if (!cmd) throw new Error(RELEASE_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/release/release-cli.ts')
	})

	// A `script` entry rather than a shell one, for the same reason `ranges` is: script paths resolve
	// against the kit package root, so it keeps working from a consumer checkout where the file lives
	// under node_modules.
	it('is a script entry listed under Versioning', () => {
		const cmd = VERSIONING_COMMANDS['release']
		if (!cmd) throw new Error(RELEASE_NOT_DEFINED)

		expect(cmd.shell).toBeUndefined()
		expect(cmd.category).toBe('Versioning')
	})
})
