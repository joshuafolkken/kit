import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The lane ledger lines `josh ship` writes about itself — a stop, the preflight's `unplanned` notice
// and the inner steps of a stage — joined into the entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// A `josh ship` that stopped on `issue`: `reason` is the stage it stopped at, or `conflict` — the
// retrospective's stop reason — and `cause` why (`run-ship-stop-cause.ts`), absent on a stop recorded
// before it had one. `preconditions` names the kinds a preflight stop found unmet (`run-ship-preflight.ts`),
// with `pre-detach` where a lane child's fast checks went red (joshuafolkken/kit#4478) and `unpinned`
// where its `test:pinned` did (joshuafolkken/kit#5228), beside them or alone, absent on any other
// stop and on one recorded before it had them. `findings` names the `<category>:<severity>` of each
// finding that decided a review or round-2 stop — the blocking ones, else the fixed ones
// (joshuafolkken/kit#4426), absent where none decided the stop. How long it stayed stopped is derived
// from the next ship stage, not recorded, so a resumed ship never has to know the stop it ends.
const stop_schema = z.object({
	kind: z.literal(KIND.STOP),
	at: z.string(),
	issue: z.number(),
	reason: z.string(),
	cause: z.string().optional(),
	preconditions: z.array(z.string()).optional(),
	findings: z.array(z.string()).optional(),
})
// The ship's `unplanned` answer `josh check:related` printed to the lane of `issue` ahead of the ship,
// so a preflight `unplanned` stop after it is told apart in `lane:stats` (joshuafolkken/kit#5203).
const unplanned_notice_schema = z.object({
	kind: z.literal(KIND.UNPLANNED_NOTICE),
	at: z.string(),
	issue: z.number(),
	files: z.array(z.string()),
})
// One inner step of a `josh ship` stage on `issue` — the overlap wait inside `sync`, the scoped pair
// inside `gate` — so `lane:breakdown` names what a stage spent its time on (joshuafolkken/kit#5294).
// `at` is its end and `elapsed_ms` its length, as on a stage row. `fallback` names why a scoped pair's
// check read the whole branch change (`since-green.ts`, joshuafolkken/kit#5531).
const ship_lap_schema = z.object({
	kind: z.literal(KIND.SHIP_LAP),
	at: z.string(),
	issue: z.number(),
	stage: z.string(),
	step: z.string(),
	elapsed_ms: z.number(),
	fallback: z.string().optional(),
})

// A merging `josh followup`'s size of `issue`: the Issue's declared size estimate and the branch's
// measured diff, test files excluded, so `lane:stats` reads how far estimates miss the guide's
// counting (joshuafolkken/kit#5384). Written before the merge, while the branch is still checked out.
const counts_schema = z.object({ files: z.number(), lines: z.number() })
const size_schema = z.object({
	kind: z.literal(KIND.SIZE),
	at: z.string(),
	issue: z.number(),
	declared: counts_schema,
	actual: counts_schema,
})

const lane_ledger_schema_ship = {
	ship_lap_schema,
	size_schema,
	stop_schema,
	unplanned_notice_schema,
}

export { lane_ledger_schema_ship }
