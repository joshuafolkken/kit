import { describe, expect, it } from 'vitest'
import { hook_tool_payload } from './hook-tool-payload'

describe('hook tool payload parsing', () => {
	it.each(['null', '""', 'false'])(
		'reads the tool independently of transcript path %s',
		(transcript_path) => {
			const raw = `{"tool_name":"Bash","tool_input":{"command":"cat CLAUDE.md"},"transcript_path":${transcript_path}}`

			expect(hook_tool_payload.parse(raw)).toEqual({
				tool_name: 'Bash',
				tool_input: { command: 'cat CLAUDE.md' },
			})
		},
	)

	it.each(['not json', '{}', '{"tool_name":""}', '{"tool_name":1}'])(
		'rejects an invalid tool payload: %s',
		(raw) => {
			expect(hook_tool_payload.parse(raw)).toBeUndefined()
		},
	)
})
