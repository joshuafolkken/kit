import { describe, expect, it } from 'vitest'
import { VERSIONING_COMMANDS } from './josh-commands-versioning'

const VERSION_UPGRADE_NOT_DEFINED = 'version:upgrade command not defined'

describe('VERSIONING_COMMANDS version:upgrade', () => {
	it('runs the version-update script that upgrades both global and project installs', () => {
		const cmd = VERSIONING_COMMANDS['version:upgrade']
		if (!cmd) throw new Error(VERSION_UPGRADE_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/version-update.ts')
	})

	it('is a script entry rather than a static shell command', () => {
		const cmd = VERSIONING_COMMANDS['version:upgrade']
		if (!cmd) throw new Error(VERSION_UPGRADE_NOT_DEFINED)

		expect(cmd.shell).toBeUndefined()
	})
})

const RANGES_NOT_DEFINED = 'ranges command not defined'

describe('VERSIONING_COMMANDS ranges', () => {
	it('runs the guard that checks every published dependency range', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		const cmd = VERSIONING_COMMANDS['ranges']
		if (!cmd) throw new Error(RANGES_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version/publishable-range-check.ts')
	})

	it('is listed under Versioning so it appears beside bump in the command help', () => {
		// eslint-disable-next-line dot-notation -- index signature requires bracket notation
		const cmd = VERSIONING_COMMANDS['ranges']
		if (!cmd) throw new Error(RANGES_NOT_DEFINED)

		expect(cmd.category).toBe('Versioning')
	})
})
