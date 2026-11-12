// Anonymized desktop rollout shape captured for #7399, including user provenance.
const CONTENT_TYPE = { user: 'input_text', assistant: 'output_text' }

function line(
	text: string,
	role: 'user' | 'assistant' = 'user',
	provenance = 'user',
	extra_content: Array<{ type: string; image_url: string }> = [],
): string {
	return JSON.stringify({
		timestamp: '2026-11-12T09:57:52.966Z',
		type: 'response_item',
		payload: {
			type: 'message',
			role,
			content: [{ type: CONTENT_TYPE[role], text }, ...extra_content],
			internal_chat_message_metadata_passthrough: {
				content_item_kinds: [provenance === 'user' ? 'user.text' : 'agents_md.instructions'],
				content_item_metadata: [
					{ provenance: { type: provenance } },
					...extra_content.map(() => ({ provenance: { type: provenance } })),
				],
			},
		},
		metadata: { client_authored: false },
	})
}

function image_line(text: string): string {
	return line(text, 'user', 'user', [
		{ type: 'input_image', image_url: 'data:image/png;base64,fixture' },
	])
}

const codex_transcript_fixture = { image_line, line }

export { codex_transcript_fixture }
