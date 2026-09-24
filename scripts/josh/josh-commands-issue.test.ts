import { describe, expect, it } from 'vitest'
import { ISSUE_COMMANDS } from './josh-commands-issue'

describe('ISSUE_COMMANDS', () => {
	it('routes the existing-issue fold assessment to its command', () => {
		expect(ISSUE_COMMANDS['issue:fold-existing']?.script).toBe(
			'scripts/issue/issue-fold-existing-cli.ts',
		)
	})
})
