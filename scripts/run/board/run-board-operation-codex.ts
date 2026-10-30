import type { TranscriptRecord } from '#scripts/lib/transcript-record'
import { z } from 'zod'

const CHANGES_SCHEMA = z.array(z.object({ path: z.string() }))
const ITEM_SCHEMA = z.object({
	type: z.enum(['item.started', 'item.updated', 'item.completed']),
	timestamp: z.string(),
	item: z.object({
		type: z.enum(['command_execution', 'file_change']),
		command: z.string().optional(),
		changes: CHANGES_SCHEMA.optional(),
	}),
})

function input_of(item: z.infer<typeof ITEM_SCHEMA>['item']): unknown {
	return item.type === 'command_execution'
		? { command: item.command }
		: { file_path: item.changes?.at(-1)?.path }
}

// Normalize only the call, leaving path shortening and credential removal to the shared reader.
function record_of(value: unknown): TranscriptRecord | undefined {
	const record = ITEM_SCHEMA.safeParse(value).data
	if (record === undefined) return undefined
	const { item, timestamp } = record
	const is_command = item.type === 'command_execution'
	const input = input_of(item)

	return {
		timestamp,
		message: { content: [{ type: 'tool_use', name: is_command ? 'Bash' : 'Edit', input }] },
	}
}

const run_board_operation_codex = { record_of }

export { run_board_operation_codex }
