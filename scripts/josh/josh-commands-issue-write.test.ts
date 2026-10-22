import { describe, expect, it } from 'vitest'
import { COMMAND_MAP } from './josh-command-map'
import { ISSUE_WRITE_COMMANDS } from './josh-commands-issue-write'

describe('ISSUE_WRITE_COMMANDS', () => {
	it('reaches the command map with every entry intact', () => {
		const missing = Object.entries(ISSUE_WRITE_COMMANDS).filter(
			([name, entry]) => COMMAND_MAP[name] !== entry,
		)

		expect(missing).toEqual([])
	})

	it('carries the usage of `issue:file` on its entry', () => {
		expect(ISSUE_WRITE_COMMANDS['issue:file']?.usage.examples.length).toBeGreaterThan(0)
	})
})
