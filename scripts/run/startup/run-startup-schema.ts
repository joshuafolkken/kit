import { lane_ledger_kind } from '#scripts/lane/lane-ledger-kind'
import { z } from 'zod'

const scope_schema = z.object({
	run: z.string(),
	attempt: z.string(),
	issue: z.string().optional(),
	span: z.string().optional(),
	parent: z.string().optional(),
	destination: z.string().optional(),
})

const entry_schema = scope_schema.omit({ destination: true }).extend({
	kind: z.literal(lane_ledger_kind.KIND.STARTUP),
	at: z.string(),
	id: z.string(),
	parent: z.string().optional(),
	phase: z.string(),
	edge: z.enum(['start', 'done', 'failed', 'waiting', 'api', 'cache']),
	elapsed_ms: z.number().nonnegative().optional(),
	metric: z.string().optional(),
	key: z.string().optional(),
})

type StartupScope = z.infer<typeof scope_schema>
type StartupEntry = z.infer<typeof entry_schema>

const run_startup_schema = { scope_schema, entry_schema }
export type { StartupScope, StartupEntry }
export { run_startup_schema }
