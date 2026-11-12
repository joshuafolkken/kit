import { describe, expect, it } from 'vitest'
import { cost_audit_command } from './cost-audit-command'

const { command_key } = cost_audit_command

describe('cost_audit_command.command_key', () => {
	it.each([
		['git status --short', 'git status'],
		['gh issue view 7137 --json body', 'gh issue view'],
		['pnpm vitest run tools/x.test.ts', 'pnpm vitest run'],
		['git log origin main extra', 'git log origin'],
		['sed -n 1,20p a.ts', 'sed'],
		['sleep 20', 'sleep'],
		['grep -n "function" a.ts', 'grep'],
	])('keys %s as %s', (command, key) => {
		expect(command_key(command)).toBe(key)
	})

	it('reads the segment that runs, past navigation and wrappers', () => {
		expect(command_key('cd /repo && timeout 5 git diff --stat')).toBe('git diff')
	})

	it('keys a command with no segment that runs as empty', () => {
		expect(command_key('cd /repo')).toBe('')
	})

	it.each(['pnpm josh', 'pnpm josh --help', 'npx josh gate', 'josh'])(
		'keys josh call %s as empty',
		(command) => {
			expect(command_key(command)).toBe('')
		},
	)

	it('keys a command that only starts with josh by its words', () => {
		const command = 'joshua status'

		expect(command_key(command)).toBe(command)
	})
})
