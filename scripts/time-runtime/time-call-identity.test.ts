import { describe, expect, it } from 'vitest'
import { time_call_identity } from './time-call-identity'
import { time_spans } from './time-spans'

// The identity is built through the same `to_tool_call` a transcript parse uses, so these cases
// exercise it the way both readers do: a live `{name, input}` reduced to a `ToolCall`, then keyed.

function identity(name: string, input: unknown): string {
	return time_call_identity.identity_of(time_spans.to_tool_call(name, input, ''))
}

describe('time_call_identity.identity_of', () => {
	it('gives two reads of the same file the same identity', () => {
		expect(identity('Read', { file_path: 'a.ts' })).toBe(identity('Read', { file_path: 'a.ts' }))
	})

	// The command is part of the key: a read and an edit of one file are not the same call.
	it('separates a read from an edit of the same file', () => {
		expect(identity('Read', { file_path: 'a.ts' })).not.toBe(
			identity('Edit', { file_path: 'a.ts' }),
		)
	})

	it('separates two reads of different files', () => {
		expect(identity('Read', { file_path: 'a.ts' })).not.toBe(
			identity('Read', { file_path: 'b.ts' }),
		)
	})

	// The targets are sorted before joining, so the same two paths named in either order are one call.
	it('is order-independent in the targets a call names', () => {
		expect(identity('Bash', { command: 'grep x a.ts b.ts' })).toBe(
			identity('Bash', { command: 'grep x b.ts a.ts' }),
		)
	})
})
