import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

const schema = z.object({
	tool_name: z.string().min(1),
	tool_input: z.unknown(),
})

function parse(raw_payload: string): z.infer<typeof schema> | undefined {
	return json_value.parse_with(raw_payload, schema)
}

const hook_tool_payload = { parse, schema }

export { hook_tool_payload }
