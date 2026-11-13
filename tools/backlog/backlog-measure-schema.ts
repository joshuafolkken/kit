import { z } from 'zod'

const DEFAULT_TIMEOUT_MS = 60_000

const READ_METHOD =
	/^(?:gh\.(?:issue_(?:get|list|blocked_by)|repo_get|pr_list)\w*|defect\.measure_window|net\.measurements|resume\.(?:paused_issues|open_pr_issues))$/u
const read_schema = z.object({
	method: z.string().regex(READ_METHOD),
	args: z.array(z.unknown()).optional(),
	value: z.unknown(),
	encoding: z.enum(['json', 'set', 'listing']).default('json'),
})
const scenario_schema = z.object({
	name: z.string().regex(/^[a-z\d-]+$/u),
	mode: z.enum(['warm', 'cold']),
	repetitions: z.number().int().positive(),
	timeout_ms: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
	reads: z.array(read_schema),
	live_get: z.array(z.string().regex(/^(?:repos\/|search\/|rate_limit$|user$)/u)).default([]),
	in_flight: z.array(z.string()).default([]),
	free_lanes: z.number().int().nonnegative(),
	memory_held: z.boolean().default(false),
	usage_limited: z.boolean().default(false),
	outcomes: z.record(z.string(), z.enum(['launched', 'waiting', 'failed', 'unopened'])).default({}),
})

type MeasureScenario = z.infer<typeof scenario_schema>

interface MeasureBoundary {
	attempt: string
	source: 'live' | 'replay' | 'replacement' | 'denied'
	operation: string
}

const backlog_measure_schema = { scenario_schema, string_set: z.array(z.string()) }
export { backlog_measure_schema }
export type { MeasureScenario, MeasureBoundary }
