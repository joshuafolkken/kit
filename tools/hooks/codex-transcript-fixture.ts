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

const codex_transcript_fixture = { line }

export { codex_transcript_fixture }
