import { codex_transcript_fixture } from '#tools/hooks/codex-transcript-fixture'
import { describe, expect, it } from 'vitest'
import { codex_prompt } from './codex-prompt'

const { line } = codex_transcript_fixture
const TIMESTAMP = '2026-11-12T09:57:52.966Z'

describe('codex_prompt.normalize', () => {
	it('translates proven user content without requiring client_authored to be true', () => {
		const normalized = JSON.parse(codex_prompt.normalize(line('起票して')))

		expect(normalized).toEqual({
			type: 'user',
			timestamp: TIMESTAMP,
			message: { content: '起票して' },
		})
	})

	it('retains only user-authored blocks in mixed content', () => {
		const raw = JSON.parse(line('調査して'))

		raw.payload.content.push({ type: 'input_text', text: '起票して' })
		raw.payload.internal_chat_message_metadata_passthrough.content_item_metadata.push({
			provenance: { type: 'harness' },
		})

		const normalized = codex_prompt.normalize(JSON.stringify(raw))

		expect(JSON.parse(normalized).message.content).toBe('調査して')
	})

	it('marks mismatched provenance as harness-authored', () => {
		const raw = JSON.parse(line('起票して'))

		raw.payload.internal_chat_message_metadata_passthrough.content_item_metadata = []
		const serialized = JSON.stringify(raw)

		expect(JSON.parse(codex_prompt.normalize(serialized)).origin).toEqual({ kind: 'harness' })
	})

	it.each(['not json', '{}', '{"type":"user","message":{"content":"起票して"}}'])(
		'preserves other transcript formats: %s',
		(raw) => {
			expect(codex_prompt.normalize(raw)).toBe(raw)
		},
	)
})

describe('codex_prompt.normalize — harness boundaries', () => {
	it('reads text beside an image while retaining provenance alignment', () => {
		const raw = codex_transcript_fixture.image_line('調査だけ続けて')

		expect(JSON.parse(codex_prompt.normalize(raw)).message.content).toBe('調査だけ続けて\n')
	})

	it.each(['agents_md', 'harness'])(
		'marks injected %s context as harness-authored',
		(provenance) => {
			const raw = line('起票して', 'user', provenance)

			expect(JSON.parse(codex_prompt.normalize(raw))).toEqual({
				type: 'user',
				timestamp: TIMESTAMP,
				origin: { kind: 'harness' },
				message: { content: '' },
			})
		},
	)
})
