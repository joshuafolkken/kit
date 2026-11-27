import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The run board's finish estimate, written once per lane child dispatch (joshuafolkken/kit#7775):
// `run` is the run's start instant as ISO (`run-board-estimate-record.ts`), `issue` the child just dispatched and `finish_at`
// the instant the run was then expected to end — so `lane:stats` can set it against the actual end.

const { KIND } = lane_ledger_kind

const estimate_schema = z.object({
	kind: z.literal(KIND.ESTIMATE),
	at: z.string(),
	issue: z.number(),
	run: z.string(),
	finish_at: z.string(),
})

// The size an Issue declared, as `lane:plan` read it when its lane started (joshuafolkken/kit#8954):
// the board bands a running or waiting row's finish by it, before the merge writes its `size` record.
// An Issue declaring no size writes none; a re-plan writes another, and the latest one counts.
const declared_schema = z.object({
	kind: z.literal(KIND.DECLARED),
	at: z.string(),
	issue: z.number(),
	files: z.number(),
	lines: z.number(),
})

type EstimateEntry = z.infer<typeof estimate_schema>
type EstimateRecord = Omit<EstimateEntry, 'kind' | 'at'>
type DeclaredEntry = z.infer<typeof declared_schema>
type DeclaredRecord = Omit<DeclaredEntry, 'kind' | 'at'>

const lane_ledger_schema_estimate = { declared_schema, estimate_schema }

export type { DeclaredEntry, DeclaredRecord, EstimateEntry, EstimateRecord }
export { lane_ledger_schema_estimate }
