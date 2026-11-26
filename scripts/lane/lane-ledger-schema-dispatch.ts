import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The dispatch a lane records, joined into the entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// Why the child runs on its model (joshuafolkken/kit#8815): the Issue's `worker:<name>` label,
// `josh.worker.route` reading the Issue body, the repository's `josh.worker` default, or — without
// `josh.worker` — the environment's worker profile.
const DISPATCH_REASON = z.enum(['label', 'route', 'default', 'environment'])

// A lane child started on `issue` — the instant its implementation is timed from. `model` and `reason`
// are the implement model the child was launched on and why; absent on rows written before them.
const dispatch_schema = z.object({
	kind: z.literal(KIND.DISPATCH),
	at: z.string(),
	issue: z.number(),
	model: z.string().optional(),
	reason: DISPATCH_REASON.optional(),
})

type DispatchEntry = z.infer<typeof dispatch_schema>
type DispatchRecord = Omit<DispatchEntry, 'kind' | 'at'>
type DispatchReason = z.infer<typeof DISPATCH_REASON>

const lane_ledger_schema_dispatch = { dispatch_schema }

export type { DispatchEntry, DispatchReason, DispatchRecord }
export { lane_ledger_schema_dispatch }
