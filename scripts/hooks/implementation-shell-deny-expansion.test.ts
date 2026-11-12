import { describe, expect, it } from 'vitest'
import { implementation_shell_deny_expansion } from './implementation-shell-deny-expansion'

describe('implementation_shell_deny_expansion.is_dynamic', () => {
	it.each(['$verb', '${GIT}', '`cmd`', 'x$y'])('reads %s as a word the shell expands', (word) => {
		expect(implementation_shell_deny_expansion.is_dynamic(word)).toBe(true)
	})

	it.each(['push', '--force', "'push'"])('reads %s as a literal word', (word) => {
		expect(implementation_shell_deny_expansion.is_dynamic(word)).toBe(false)
	})
})

describe('implementation_shell_deny_expansion.refusal', () => {
	it('names the program and the expanded word', () => {
		expect(implementation_shell_deny_expansion.refusal('gh issue', '$verb')).toBe(
			'`gh issue $verb`, an expansion that may spell a write',
		)
	})
})
