import { z } from 'zod'

const CLAUDE_WINDOW = z.looseObject({ utilization: z.number(), resetsAt: z.number() })
const CLAUDE_WINDOWS = z.looseObject({
	five_hour: CLAUDE_WINDOW.optional(),
	seven_day: CLAUDE_WINDOW.optional(),
})
const CLAUDE_EVENT = z.looseObject({
	type: z.literal('rate_limit_event'),
	rate_limit_info: z.looseObject({
		unifiedWindows: CLAUDE_WINDOWS.optional(),
		status: z.string().optional(),
	}),
	timestamp: z.string().nullish().catch(undefined),
})
const LIMIT_CODE = z.enum(['rate_limit', 'rate_limit_error', 'usage_limit_reached'])
const TOO_MANY_REQUESTS = 429
const LIMIT_ERROR = z.union([
	LIMIT_CODE,
	z.looseObject({ code: LIMIT_CODE }),
	z.looseObject({ type: LIMIT_CODE }),
	z.looseObject({ status: z.literal(TOO_MANY_REQUESTS) }),
])
const ERROR_EVENT = z.looseObject({
	type: z.enum(['assistant', 'error']),
	error: LIMIT_ERROR,
})

function is_rejected(value: unknown): boolean {
	const event = CLAUDE_EVENT.safeParse(value)

	return event.success
		? event.data.rate_limit_info.status === 'rejected'
		: ERROR_EVENT.safeParse(value).success
}

const agent_usage_limit = { CLAUDE_EVENT, is_rejected }

export { agent_usage_limit }
