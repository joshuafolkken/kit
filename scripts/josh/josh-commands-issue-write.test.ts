import { describe, expect, it } from 'vitest'
import { ISSUE_WRITE_COMMANDS } from './josh-commands-issue-write'

describe('ISSUE_WRITE_COMMANDS', () => {
	it('carries the usage of `issue:file` on its entry', () => {
		expect(ISSUE_WRITE_COMMANDS['issue:file']?.usage.examples.length).toBeGreaterThan(0)
	})
})
