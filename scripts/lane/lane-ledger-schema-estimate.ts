import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The run board's finish estimate, written once per lane child dispatch (joshuafolkken/kit#7775):
// `run` is the run's invocation (`run-carry.ts`), `issue` the child just dispatched and `finish_at`
// the instant the run was then expected to end — so `lane:stats` can set it against the actual end.

const { KIND } = lane_ledger_kind

const estimate_schema = z.object({
	kind: z.literal(KIND.ESTIMATE),
	at: z.string(),
	issue: z.number(),
	run: z.string(),
	finish_at: z.string(),
})

type EstimateEntry = z.infer<typeof estimate_schema>
type EstimateRecord = Omit<EstimateEntry, 'kind' | 'at'>

const lane_ledger_schema_estimate = { estimate_schema }

export type { EstimateEntry, EstimateRecord }
export { lane_ledger_schema_estimate }
