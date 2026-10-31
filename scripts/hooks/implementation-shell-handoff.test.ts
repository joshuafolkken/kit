import path from 'node:path'
import { document_section } from '#scripts/document/document-section'
import { describe, expect, it } from 'vitest'
import { implementation_shell } from './implementation-shell'

// joshuafolkken/kit#5614: every josh command the hand-back table of "The loop" has a consultation
// session type must pass the implementation-authority guard, or the branch it hands back stalls.
const LOOP_DOCUMENT = path.join(
	process.cwd(),
	'.claude',
	'skills',
	'workflow-commands',
	'backlogrun-steps.md',
)
const JOSH_COMMAND = /`(pnpm josh [^`]+)`/gu
const ISSUE_PLACEHOLDER = /<N>/gu
const PLACEHOLDER = /<\w+>/gu

function loop_commands(): Array<string> {
	const markdown = document_section.read_optional(LOOP_DOCUMENT) ?? ''
	const text = document_section.section(markdown, 'The loop')?.text ?? ''

	return [...text.matchAll(JOSH_COMMAND)].map((match) =>
		(match[1] ?? '').replaceAll(ISSUE_PLACEHOLDER, '5614').replaceAll(PLACEHOLDER, 'value'),
	)
}

describe('the backlogrun loop hand-back commands', () => {
	it('finds the hand-back commands in the loop section', () => {
		expect(loop_commands()).toContain('pnpm josh auto-ok:judge')
	})

	it.each(loop_commands())('lets the hand-back command %s through', (command) => {
		expect(implementation_shell.is_unsafe(command)).toBe(false)
	})
})
