import { describe, expect, it } from 'vitest'
import { hook_context_line } from './hook-context-line'

const { HOOK_CONTEXT_TYPE, hook_contexts_of } = hook_context_line
const NOTE = 'a note'

function attachment_line(attachment: Record<string, unknown>): string {
	return JSON.stringify({ type: 'attachment', attachment })
}

describe('hook_context_line.hook_contexts_of', () => {
	it('reads the string contents of a hook context attachment', () => {
		const line = attachment_line({ type: HOOK_CONTEXT_TYPE, content: [NOTE, 1, 'another'] })

		expect(hook_contexts_of(line)).toStrictEqual([NOTE, 'another'])
	})

	it('reads nothing from another attachment type', () => {
		const line = attachment_line({ type: 'other', content: [NOTE], hook: HOOK_CONTEXT_TYPE })

		expect(hook_contexts_of(line)).toStrictEqual([])
	})

	it('reads nothing from a line that is not JSON or carries no content list', () => {
		expect(hook_contexts_of(`not json ${HOOK_CONTEXT_TYPE}`)).toStrictEqual([])
		expect(
			hook_contexts_of(attachment_line({ type: HOOK_CONTEXT_TYPE, content: NOTE })),
		).toStrictEqual([])
	})
})
