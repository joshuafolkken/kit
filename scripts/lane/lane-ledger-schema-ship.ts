import { z } from 'zod'
import { lane_ledger_kind } from './lane-ledger-kind'

// The lane ledger lines `josh ship` writes about itself — a stop, the preflight's `unplanned` notice
// and the inner steps of a stage — and each `josh run:chain` ahead of it, joined into the entry union by `lane-ledger-schema.ts`.

const { KIND } = lane_ledger_kind

// Every early-push decision, including a skip before a push process could start.
const early_push_schema = z.object({
	kind: z.literal(KIND.EARLY_PUSH),
	at: z.string(),
	issue: z.number().optional(),
	source: z.enum(['review', 'ship']),
	result: z.string(),
})

// A `josh ship` that stopped on `issue`: `reason` is the stage it stopped at, or `conflict` — the
// retrospective's stop reason — and `cause` why (`run-ship-stop-cause.ts`), absent on a stop recorded
// before it had one. `preconditions` names the kinds a preflight stop found unmet (`run-ship-preflight.ts`),
// with `pre-detach` where a lane child's fast checks went red (joshuafolkken/kit#4478) and `unpinned`
// where its `test:pinned` did (joshuafolkken/kit#5228), beside them or alone, absent on any other
// stop and on one recorded before it had them. `findings` names the `<category>:<severity>` of each
// finding that decided a review or round-2 stop — the blocking ones, else the fixed ones
// (joshuafolkken/kit#4426), absent where none decided the stop. `base` is the change base a review
// failure or a followup `check` stopped on, so its re-ship can tell a fix-only tree from a moved base
// (joshuafolkken/kit#6141, joshuafolkken/kit#6675), absent on every other stop. How long it stayed stopped is derived
// from the next ship stage, not recorded, so a resumed ship never has to know the stop it ends.
const stop_schema = z.object({
	kind: z.literal(KIND.STOP),
	at: z.string(),
	issue: z.number(),
	reason: z.string(),
	cause: z.string().optional(),
	preconditions: z.array(z.string()).optional(),
	findings: z.array(z.string()).optional(),
	base: z.string().optional(),
})
// One `josh run:chain` on `issue`, done or stopped: `at` is its end and `elapsed_ms` its length, so the
// next run's start ends the wait after a stop. `stage` names where it stopped and `reason` why — the
// stage exited non-zero (`exit`) or exited 0 on a notice that holds the run (`hold`) — both absent on a
// run that finished. `join` marks the half after the review (joshuafolkken/kit#7024).
const chain_schema = z.object({
	kind: z.literal(KIND.CHAIN),
	at: z.string(),
	issue: z.number(),
	elapsed_ms: z.number(),
	join: z.boolean(),
	stage: z.string().optional(),
	reason: z.enum(['exit', 'hold']).optional(),
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
// check read the whole branch change (`since-green.ts`, joshuafolkken/kit#5531). `runs` counts the times
// this ship process ran the scoped pair's checks, this one included, and `rerun` names why a run after
// the first ran again (`run-ship-pair-runs.ts`, joshuafolkken/kit#5538) — both absent on a lap that ran none.
// On a `josh gate` lap `rerun` names why the gate ran and `reused_tree` the tree hash of a gate the ship
// reused rather than started (`run-ship-gate-runs.ts`, joshuafolkken/kit#5567). On a scoped pair lap
// `named` counts the files the pair was narrowed to, and `unsplit` is the reason the import graph could
// not split a merge (`test-related-synced.ts`), both absent where neither happened — read by
// `lane:stats --pairs` (joshuafolkken/kit#6189), written by the ship (joshuafolkken/kit#6196).
const ship_lap_schema = z.object({
	kind: z.literal(KIND.SHIP_LAP),
	at: z.string(),
	issue: z.number(),
	stage: z.string(),
	step: z.string(),
	elapsed_ms: z.number(),
	fallback: z.string().optional(),
	runs: z.number().optional(),
	rerun: z.string().optional(),
	reused_tree: z.string().optional(),
	is_reused: z.boolean().optional(),
	named: z.number().optional(),
	unsplit: z.string().optional(),
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
	chain_schema,
	early_push_schema,
	ship_lap_schema,
	size_schema,
	stop_schema,
	unplanned_notice_schema,
}

export { lane_ledger_schema_ship }
