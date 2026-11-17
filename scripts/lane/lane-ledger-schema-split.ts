import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The split notices and filings a lane records, and the pre-push hook's reuse misses, joined into the
// entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// The split notice shown to the lane of `issue`, with the measured diff it fired on — the diff notice
// written once per Issue, by whichever of `josh lint:related`, `test:related` or `main:merge` showed it
// first (joshuafolkken/kit#4695). Each `split` from `josh lane:plan` writes one more, `reason` naming its
// axis; a diff notice has none (joshuafolkken/kit#5568), and the implement-budget notice is `budget`
// (joshuafolkken/kit#6544).
const split_notice_schema = z.object({
	kind: z.literal(KIND.SPLIT_NOTICE),
	at: z.string(),
	issue: z.number(),
	files: z.number(),
	lines: z.number(),
	reason: z.enum(['files', 'hunks', 'lines', 'hub', 'budget']).optional(),
	// Why a `--single` plan cannot be merged in parts (joshuafolkken/kit#7729).
	single_reason: z.string().optional(),
})
// One `josh issue:file --route split` filed from the lane of `issue`; `child` is its reference.
const split_filed_schema = z.object({
	kind: z.literal(KIND.SPLIT_FILED),
	at: z.string(),
	issue: z.number(),
	child: z.string(),
})
// A pre-push hook that could not reuse the green gate record and ran the `whole` or the `related`
// suite: `reason` is the miss's kind (`hook_gate_reuse.miss_kind`), never its sentence (joshuafolkken/kit#5234).
const push_miss_schema = z.object({
	kind: z.literal(KIND.PUSH_MISS),
	at: z.string(),
	scope: z.enum(['whole', 'related']),
	reason: z.string(),
})

const lane_ledger_schema_split = { split_notice_schema, split_filed_schema, push_miss_schema }

export { lane_ledger_schema_split }
