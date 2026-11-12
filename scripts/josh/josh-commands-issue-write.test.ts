import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ISSUE_WRITE_COMMANDS } from './josh-commands-issue-write'

describe('ISSUE_WRITE_COMMANDS', () => {
	it('registers the tick command used by the cut procedure (ac-8647b0dd)', () => {
		const procedure = readFileSync('.claude/skills/workflow-commands/pre-gate-cut.md', 'utf8')

		expect(ISSUE_WRITE_COMMANDS['issue:tick']?.script).toBe('scripts/issue/issue-tick-cli.ts')
		expect(procedure).toContain('pnpm josh issue:tick <N> <ac-id>...')
		expect(procedure).not.toContain('gh issue edit <N> --body-file')
	})
	it('carries the usage of `issue:file` on its entry', () => {
		expect(ISSUE_WRITE_COMMANDS['issue:file']?.usage.examples.length).toBeGreaterThan(0)
	})
})
