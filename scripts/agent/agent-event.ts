import { z } from 'zod'
import type { AgentProvider } from './agent-role-profile'
import { claude_result_event } from './claude-result-event'

const TEXT_BLOCK_SCHEMA = z.looseObject({ type: z.literal('text'), text: z.string() })
const CLAUDE_MESSAGE_SCHEMA = z.looseObject({ content: z.array(z.unknown()).optional() })
const CLAUDE_INIT_SCHEMA = z.looseObject({ type: z.literal('system'), subtype: z.literal('init') })
const CLAUDE_ASSISTANT_SCHEMA = z.looseObject({
	type: z.literal('assistant'),
	message: CLAUDE_MESSAGE_SCHEMA,
})
const USAGE_SCHEMA = z.looseObject({
	input_tokens: z.number().optional(),
	cached_input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
})
const CODEX_START_SCHEMA = z.looseObject({ type: z.enum(['thread.started', 'turn.started']) })
const CODEX_PROGRESS_SCHEMA = z.looseObject({
	type: z.enum(['item.started', 'item.updated', 'item.completed']),
	item: z.looseObject({ type: z.string(), text: z.string().optional() }).optional(),
})
const CODEX_COMPLETE_SCHEMA = z.looseObject({
	type: z.literal('turn.completed'),
	usage: USAGE_SCHEMA.optional(),
})
const CODEX_FAILURE_SCHEMA = z.looseObject({
	type: z.enum(['turn.failed', 'error']),
	error: z.looseObject({ message: z.string().optional() }).optional(),
	message: z.string().optional(),
})

type AgentLaunch = 'pending' | 'started'
type AgentResult = 'running' | 'completed' | 'failed'
type AgentUsage = z.infer<typeof USAGE_SCHEMA>

interface AgentEventState {
	provider: AgentProvider | undefined
	launch: AgentLaunch
	progress: string | undefined
	result: AgentResult
	reason: string | undefined
	usage: AgentUsage | undefined
}

const EMPTY_STATE: AgentEventState = {
	provider: undefined,
	launch: 'pending',
	progress: undefined,
	result: 'running',
	reason: undefined,
	usage: undefined,
}
const LAUNCH_HEADER_PREFIX = '=== '
const LAUNCH_HEADER_MARKER = ' · started by process '

function parse_line(line: string): unknown {
	try {
		return JSON.parse(line)
	} catch {
		return undefined
	}
}

function usable_text(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function claude_progress(content: ReadonlyArray<unknown>): string | undefined {
	return content
		.map((block) => TEXT_BLOCK_SCHEMA.safeParse(block))
		.filter((parsed) => parsed.success)
		.map((parsed) => parsed.data.text)
		.findLast((text) => text.trim() !== '')
}

function claude_result(value: unknown, state: AgentEventState): AgentEventState | undefined {
	const result = claude_result_event.decode(value)
	if (result === undefined) return undefined

	return {
		...state,
		provider: 'anthropic',
		result: result.is_error ? 'failed' : 'completed',
		reason: result.is_error ? (result.reason ?? state.reason) : state.reason,
		usage: result.usage,
	}
}

function claude_assistant(value: unknown, state: AgentEventState): AgentEventState | undefined {
	const assistant = CLAUDE_ASSISTANT_SCHEMA.safeParse(value)
	if (!assistant.success) return undefined
	const progress = claude_progress(assistant.data.message.content ?? []) ?? state.progress

	return { ...state, provider: 'anthropic', progress }
}

function claude_terminal(value: unknown, state: AgentEventState): AgentEventState | undefined {
	return claude_result(value, state)
}

function claude_event(value: unknown, state: AgentEventState): AgentEventState | undefined {
	if (CLAUDE_INIT_SCHEMA.safeParse(value).success) {
		return { ...state, provider: 'anthropic', launch: 'started' }
	}

	return claude_assistant(value, state) ?? claude_terminal(value, state)
}

function codex_progress(value: unknown, state: AgentEventState): AgentEventState | undefined {
	const parsed = CODEX_PROGRESS_SCHEMA.safeParse(value)
	if (!parsed.success) return undefined
	const progress = usable_text(parsed.data.item?.text) ?? state.progress

	return { ...state, provider: 'openai', progress }
}

function codex_completed(value: unknown, state: AgentEventState): AgentEventState | undefined {
	const completed = CODEX_COMPLETE_SCHEMA.safeParse(value)
	if (!completed.success) return undefined

	return { ...state, provider: 'openai', result: 'completed', usage: completed.data.usage }
}

function codex_failed(value: unknown, state: AgentEventState): AgentEventState | undefined {
	const failed = CODEX_FAILURE_SCHEMA.safeParse(value)
	if (!failed.success) return undefined
	const reason = usable_text(failed.data.error?.message) ?? usable_text(failed.data.message)

	return { ...state, provider: 'openai', result: 'failed', reason: reason ?? state.reason }
}

function codex_terminal(value: unknown, state: AgentEventState): AgentEventState | undefined {
	return codex_completed(value, state) ?? codex_failed(value, state)
}

function codex_event(value: unknown, state: AgentEventState): AgentEventState | undefined {
	if (CODEX_START_SCHEMA.safeParse(value).success) {
		return { ...state, provider: 'openai', launch: 'started' }
	}

	return codex_progress(value, state) ?? codex_terminal(value, state)
}

function normalized(value: unknown, state: AgentEventState): AgentEventState {
	return claude_event(value, state) ?? codex_event(value, state) ?? state
}

function next_state(line: string, state: AgentEventState): AgentEventState {
	const is_header = line.startsWith(LAUNCH_HEADER_PREFIX) && line.includes(LAUNCH_HEADER_MARKER)
	if (is_header) return EMPTY_STATE

	return normalized(parse_line(line), state)
}

function read(transcript: string): AgentEventState {
	let state = EMPTY_STATE

	for (const line of transcript.split('\n')) state = next_state(line, state)

	return state
}

function describe(state: AgentEventState): string {
	const progress = state.progress === undefined ? '' : ` progress=${state.progress}`
	const reason = state.reason === undefined ? '' : ` reason=${state.reason}`

	return `launch=${state.launch} result=${state.result}${progress}${reason}`
}

const agent_event = { describe, read }

export type { AgentEventState, AgentLaunch, AgentResult, AgentUsage }
export { agent_event }
