import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// Native desktop rollouts mark each content item's provenance. A user role alone also
// carries AGENTS/environment context, so only user-authored items become prompts (#7399).
const content_schema = z.array(
	z.object({
		type: z.string(),
		text: z.string().optional(),
	}),
)
const provenance_schema = z.object({ provenance: z.object({ type: z.string() }) })
const metadata_schema = z.object({ content_item_metadata: z.array(provenance_schema) })
const payload_schema = z.object({
	type: z.literal('message'),
	role: z.enum(['user', 'assistant']),
	content: content_schema,
	internal_chat_message_metadata_passthrough: metadata_schema.optional(),
})
const record_schema = z.object({
	type: z.literal('response_item'),
	timestamp: z.string(),
	payload: payload_schema,
})

function content_text(block: z.infer<typeof content_schema>[number]): string {
	if (block.type !== 'input_text' && block.type !== 'output_text') return ''

	return block.text ?? ''
}

function person_content(payload: z.infer<typeof record_schema>['payload']): string | undefined {
	const metadata = payload.internal_chat_message_metadata_passthrough?.content_item_metadata
	if (metadata?.length !== payload.content.length) return undefined

	const authored = payload.content
		.filter((_block, index) => metadata[index]?.provenance.type === 'user')
		.map((block) => content_text(block))

	return authored.length === 0 ? undefined : authored.join('\n')
}

// Preserve user turn boundaries while marking unproven content as harness-authored.
function normalize(line: string): string {
	const record = json_value.parse_with(line, record_schema)
	if (record === undefined) return line
	const { payload, timestamp } = record
	const content =
		payload.role === 'user'
			? person_content(payload)
			: payload.content.map((block) => content_text(block)).join('\n')

	return JSON.stringify({
		type: payload.role,
		timestamp,
		...(content === undefined && { origin: { kind: 'harness' } }),
		message: { content: content ?? '' },
	})
}

const codex_prompt = { normalize }

export { codex_prompt }
