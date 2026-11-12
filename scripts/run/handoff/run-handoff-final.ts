import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'

// What a handed-off child said last, read back from its log: a Claude child's `result` event, a Codex
// child's last completed `agent_message`. The log is the child's stream, one JSON event per line, under
// the launcher's own header lines, which are not JSON and are passed over.

const CLAUDE_RESULT_SCHEMA = z.object({ type: z.literal('result'), result: z.string() })
const CODEX_MESSAGE_SCHEMA = z.object({
	type: z.literal('item.completed'),
	item: z.object({ type: z.literal('agent_message'), text: z.string() }),
})
// An Issue or a pull request, the two things a workflow creates and the brief asks the child to name.
const GITHUB_URL_PATTERN = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+/gu

function message_of(line: string): string | undefined {
	const value = json_value.parse_or_undefined(line)

	return (
		CLAUDE_RESULT_SCHEMA.safeParse(value).data?.result ??
		CODEX_MESSAGE_SCHEMA.safeParse(value).data?.item.text
	)
}

function final_message(log: string): string | undefined {
	return log
		.split('\n')
		.map((line) => message_of(line))
		.findLast((message) => message !== undefined)
}

function github_urls(text: string): ReadonlyArray<string> {
	return [...new Set(text.match(GITHUB_URL_PATTERN))]
}

const run_handoff_final = { final_message, github_urls }

export { run_handoff_final }
