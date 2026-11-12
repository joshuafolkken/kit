import { describe, expect, it } from 'vitest'
import { hook_decision } from './hook-decision'
import { hook_tool_payload } from './hook-tool-payload'

describe('hook tool payload history independence', () => {
	it.each(['null', '""', undefined])(
		'keeps tool parsing separate from unavailable history %j (ac-547760fa)',
		(transcript_path) => {
			const tool = { tool_name: 'Edit', tool_input: { file_path: 'app.ts' } }
			const history = transcript_path === undefined ? '' : `,"transcript_path":${transcript_path}`
			const raw = `{"tool_name":"Edit","tool_input":{"file_path":"app.ts"}${history}}`

			expect(hook_tool_payload.parse(raw)).toEqual(tool)
			expect(hook_decision.parse_hook_payload(raw)).toBeUndefined()
		},
	)

	it('preserves a valid history payload', () => {
		const payload = {
			tool_name: 'Read',
			tool_input: { file_path: 'app.ts' },
			transcript_path: '/repo/transcript.jsonl',
		}

		expect(hook_decision.parse_hook_payload(JSON.stringify(payload))).toEqual(payload)
	})
})

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
