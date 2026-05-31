import { describe, expect, it } from 'vitest'
import { VERSIONING_COMMANDS } from './josh-commands-versioning'

const VERSION_UPGRADE_NOT_DEFINED = 'version:upgrade command not defined'

describe('VERSIONING_COMMANDS version:upgrade', () => {
	it('runs the version-update script that detects global vs local invocation', () => {
		const cmd = VERSIONING_COMMANDS['version:upgrade']
		if (!cmd) throw new Error(VERSION_UPGRADE_NOT_DEFINED)

		expect(cmd.script).toBe('scripts/version-update.ts')
	})

	it('is a script entry rather than a static shell command', () => {
		const cmd = VERSIONING_COMMANDS['version:upgrade']
		if (!cmd) throw new Error(VERSION_UPGRADE_NOT_DEFINED)

		expect(cmd.shell).toBeUndefined()
	})
})
