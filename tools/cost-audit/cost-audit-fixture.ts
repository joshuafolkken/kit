import { cost_usage, type UsageRecord } from '#scripts/cost-runtime/cost-usage'
import { time_transcript_fixture } from '#tools/time/time-transcript-fixture'
import type { AuditSession } from './cost-audit-read'
import type { ToolCategory } from './cost-audit-tool'

// Transcript lines and sessions for the `josh cost:audit` suites. A request is priced on Haiku input
// tokens, $1 per million, so a fixture's dollars read straight off its token count.

const { at, ms } = time_transcript_fixture
const MODEL = 'claude-haiku-4-5'
const TOKENS_PER_USD = 1_000_000
const MINUTES_PER_DAY = 1440

interface ToolUse {
	name: string
	input: unknown
}

function prompt_line(minute: number, text: string): string {
	return JSON.stringify({ type: 'user', timestamp: at(minute), message: { content: text } })
}

// One assistant line of request `id`, billed `usd` and issuing the given calls.
function request_line(
	minute: number,
	id: string,
	usd: number,
	calls: ReadonlyArray<ToolUse> = [],
): string {
	const content = calls.map((call) => ({ type: 'tool_use', id: `${id}-${call.name}`, ...call }))

	return JSON.stringify({
		type: 'assistant',
		requestId: id,
		timestamp: at(minute),
		message: {
			id: `msg-${id}`,
			model: MODEL,
			usage: { input_tokens: usd * TOKENS_PER_USD, output_tokens: 0 },
			content,
		},
	})
}

function record(id: string, minute: number, usd: number): UsageRecord {
	return {
		request_id: id,
		model: MODEL,
		branch: '',
		at_ms: ms(minute),
		totals: { ...cost_usage.EMPTY_TOTALS, input_tokens: usd * TOKENS_PER_USD },
	}
}

function session(
	kind: string,
	records: ReadonlyArray<UsageRecord>,
	categories: ReadonlyArray<readonly [string, ReadonlyArray<ToolCategory>]> = [],
): AuditSession {
	return { kind, records, categories: new Map(categories), lines: [] }
}

// The minute `days` after the fixture epoch, so a period boundary falls on a whole day.
function day(days: number): number {
	return days * MINUTES_PER_DAY
}

const cost_audit_fixture = { ms, day, prompt_line, request_line, record, session }

export { cost_audit_fixture }
