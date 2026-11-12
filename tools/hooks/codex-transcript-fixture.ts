// Anonymized desktop rollout shape captured for #7399, including user provenance.
function line(text: string, role = 'user', provenance = 'user'): string {
	return JSON.stringify({
		timestamp: '2026-11-12T09:57:52.966Z',
		type: 'response_item',
		payload: {
			type: 'message',
			role,
			content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }],
			internal_chat_message_metadata_passthrough: {
				content_item_kinds: [provenance === 'user' ? 'user.text' : 'agents_md.instructions'],
				content_item_metadata: [{ provenance: { type: provenance } }],
			},
		},
		metadata: { client_authored: false },
	})
}

function image_line(text: string): string {
	const raw = JSON.parse(line(text))

	raw.payload.content.push({ type: 'input_image', image_url: 'data:image/png;base64,fixture' })
	raw.payload.internal_chat_message_metadata_passthrough.content_item_metadata.push({
		provenance: { type: 'user' },
	})

	return JSON.stringify(raw)
}

const codex_transcript_fixture = { image_line, line }

export { codex_transcript_fixture }
