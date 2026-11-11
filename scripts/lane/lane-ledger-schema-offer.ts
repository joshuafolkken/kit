import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The decision one `backlog:next` ask reached, joined into the entry union by `lane-ledger-schema.ts`
// (joshuafolkken/kit#7306). `verdict` is the ask's answer — `run`, `triage`, `retry`, `wait`, `stop`,
// `none` or `error`; `seen` the opted-in issues it read; `started` the numbers it offered; `excluded`
// each issue it held back and why; `is_unchanged` whether every page of the listing answered 304.

const { KIND } = lane_ledger_kind

const exclusion_schema = z.object({ issue: z.number(), reason: z.string() })

const offer_schema = z.object({
	kind: z.literal(KIND.OFFER),
	at: z.string(),
	verdict: z.string(),
	seen: z.array(z.number()),
	started: z.array(z.number()),
	excluded: z.array(exclusion_schema),
	is_unchanged: z.boolean(),
})

type OfferEntry = z.infer<typeof offer_schema>
type OfferRecord = Omit<OfferEntry, 'kind' | 'at'>
type OfferExclusion = z.infer<typeof exclusion_schema>

const lane_ledger_schema_offer = { offer_schema }

export type { OfferEntry, OfferExclusion, OfferRecord }
export { lane_ledger_schema_offer }
