import { z } from 'zod'

// The shape of each line `lane-ledger.ts` appends and reads back — one schema per entry kind.

const KIND = {
	MERGE: 'merge',
	GATE: 'gate',
	LOAD: 'load',
	DISPATCH: 'dispatch',
	STAGE: 'stage',
	STOP: 'stop',
	OVERLAP: 'overlap',
	HELD: 'held',
	RELEASED: 'released',
	ROUND_TWO: 'round-two',
	OFFERABLE: 'offerable',
	CORE_WAIT: 'core-wait',
	UNIT_FILES: 'unit-files',
	TEST_RELATED: 'test-related',
} as const

const merge_schema = z.object({ kind: z.literal(KIND.MERGE), at: z.string(), issue: z.number() })
const check_schema = z.object({
	label: z.string(),
	elapsed_ms: z.number(),
	is_passed: z.boolean(),
	is_reused: z.boolean().optional(),
	// The CPU milliseconds the check's process tree spent, so a core weight can be re-measured from
	// the ledger (joshuafolkken/kit#4362). Absent where the gate could not read it (off macOS).
	cpu_ms: z.number().optional(),
	// Why the unit leg ran the whole suite instead of the related tests — a stable kind, never the
	// file it names (joshuafolkken/kit#4397). Absent when it narrowed, and on every other check.
	fallback: z.string().optional(),
	// The unit leg's since-green no-op: nothing moved, so it ran no test (joshuafolkken/kit#4457).
	is_unmoved: z.boolean().optional(),
	// The width the check asked the core budget for, the width it ran at and how long it waited, so a
	// unit claim's wait for room is read per run (joshuafolkken/kit#4451). Absent on a check that
	// claimed none — a reused one, or one inside another gate's claim.
	claim: z.object({ requested: z.number(), granted: z.number(), waited_ms: z.number() }).optional(),
})
const gate_schema = z.object({
	kind: z.literal(KIND.GATE),
	at: z.string(),
	elapsed_ms: z.number(),
	is_passed: z.boolean(),
	// The unit suite's own duration, present when this gate ran it — the one
	// record of a full vitest run `josh metrics` reads, so the suite is never timed twice.
	unit_ms: z.number().optional(),
	// The whole cores busy outside this gate, beyond the machine's baseline, at its start or its end —
	// whichever was higher. Absent when the machine could not be read.
	external_cores: z.number().optional(),
	// Each check's own duration and verdict, so `josh lane:stats` can name the check a slow gate waited
	// on. A reused check started no process: its row says so, and its zero is no timing.
	checks: z.array(check_schema).optional(),
	// A gate that reused a green record for this tree and base and started no check: counted, never
	// timed (joshuafolkken/kit#4397).
	is_reused: z.boolean().optional(),
})
// `available_mb`, `swapped_mb` and `lanes` are optional because each read can fail on its own — a
// platform with no memory reading, a `git worktree` call that did not answer — and a sample is still
// worth its load. `swapped_mb` is `machine_capacity`'s counter, every page swapped since boot.
// Both memory fields were renamed with their meaning (joshuafolkken/kit#3593): an older row's
// `free_mb` / `swap_mb` are stripped on read, so the two measurements never share a column.
const process_kind_schema = z.object({
	kind: z.string(),
	cpu_percent: z.number(),
	rss_mb: z.number(),
	count: z.number(),
})
const load_schema = z.object({
	kind: z.literal(KIND.LOAD),
	at: z.string(),
	load: z.number(),
	available_mb: z.number().optional(),
	swapped_mb: z.number().optional(),
	lanes: z.number().optional(),
	// The heaviest process kinds at the instant of the sample (`lane-process-load.ts`), so the load the
	// core budget's ledger does not explain can be read back by what made it (joshuafolkken/kit#3874).
	processes: z.array(process_kind_schema).optional(),
})
// A lane child started on `issue` — the instant its implementation is timed from.
const dispatch_schema = z.object({
	kind: z.literal(KIND.DISPATCH),
	at: z.string(),
	issue: z.number(),
})
// One finished stage of a lane's run, passed or failed: `at` is its end and `elapsed_ms` its length, so
// its start is read from the two. `issue` is absent where the writer does not hold one — `followup`'s
// CI wait, which is timed on a path that fails before the issue is known.
const stage_schema = z.object({
	kind: z.literal(KIND.STAGE),
	at: z.string(),
	stage: z.string(),
	elapsed_ms: z.number(),
	issue: z.number().optional(),
})
// A `josh ship` that stopped on `issue`: `reason` is the stage it stopped at, or `conflict` — the
// retrospective's stop reason — and `cause` why (`run-ship-stop-cause.ts`), absent on a stop recorded
// before it had one. `preconditions` names the kinds a preflight stop found unmet (`run-ship-preflight.ts`),
// with `pre-detach` where a lane child's fast checks went red beside them (joshuafolkken/kit#4478),
// absent on any other stop and on one recorded before it had them. `findings` names the
// `<category>:<severity>` of each finding that decided a review or round-2 stop — the blocking ones, else
// the fixed ones (joshuafolkken/kit#4426),
// absent where none decided the stop. How long it stayed stopped is derived from the next ship stage, not recorded, so a
// resumed ship never has to know the stop it ends.
const stop_schema = z.object({
	kind: z.literal(KIND.STOP),
	at: z.string(),
	issue: z.number(),
	reason: z.string(),
	cause: z.string().optional(),
	preconditions: z.array(z.string()).optional(),
	findings: z.array(z.string()).optional(),
})
// A `josh ship` on `issue` whose actual change overlapped the open pull requests of `lanes` on `paths`
// before its sync: it waited `waited_ms` for their ships to end, and `is_cleared` is false where the
// wait ran out first (joshuafolkken/kit#3901).
const overlap_schema = z.object({
	kind: z.literal(KIND.OVERLAP),
	at: z.string(),
	issue: z.number(),
	lanes: z.array(z.number()),
	paths: z.array(z.string()),
	waited_ms: z.number(),
	is_cleared: z.boolean(),
})
// A `backlog:drive` pass that left a free lane empty: `reason` is why — the offer verdict that started
// nothing, or the hand-back that stopped the driver. How long the lane stayed empty is derived from the
// next `held`, `released` or `dispatch` entry, the way a stop's wait is (joshuafolkken/kit#3995).
const held_schema = z.object({ kind: z.literal(KIND.HELD), at: z.string(), reason: z.string() })
// The end of a hold no dispatch ended: every lane taken — one opened outside the driver included — or
// the run finished, so no free lane is owed a child any more.
const released_schema = z.object({ kind: z.literal(KIND.RELEASED), at: z.string() })
// One `review:round2` decision a `josh ship` acted on for `issue`: `verdict` and the stable reason
// `code` it fell under, so the period's skips and runs are counted by why (joshuafolkken/kit#4064).
const round_two_schema = z.object({
	kind: z.literal(KIND.ROUND_TWO),
	at: z.string(),
	issue: z.number(),
	verdict: z.string(),
	code: z.string(),
})
// A stall detector observation, written only when it changes: whether offerable backlog work and a free
// lane coexisted, so a stall is aged from when both first held rather than from the last launch
// (joshuafolkken/kit#4349).
const offerable_schema = z.object({
	kind: z.literal(KIND.OFFERABLE),
	at: z.string(),
	is_offerable: z.boolean(),
})
// One claim that waited `waited_ms` for the core budget before `command` could start — written by the
// command itself, so a wait inside a gate, a scoped check or a ship lands in one record. `issue` is the
// lane the claim ran in, absent outside a lane (joshuafolkken/kit#4382).
const core_wait_schema = z.object({
	kind: z.literal(KIND.CORE_WAIT),
	at: z.string(),
	command: z.string(),
	waited_ms: z.number(),
	issue: z.number().optional(),
})
// One vitest run's slowest test files, each with its wall time from environment setup to its last
// test, so a unit run whose wall time far outran its CPU names the file it stalled on
// (joshuafolkken/kit#4451). Written by the run itself (`tools/test/unit-file-reporter.ts`).
const unit_file_schema = z.object({ file: z.string(), elapsed_ms: z.number() })
const unit_files_schema = z.object({
	kind: z.literal(KIND.UNIT_FILES),
	at: z.string(),
	files: z.array(unit_file_schema),
})
// One `josh test:related` run (joshuafolkken/kit#4465): `scope` is `related`, `none` or the full-suite
// fallback kind; the four counts are its input — the change itself, what a main sync brought into it,
// what the change since the test-read map's tree joined to it and the map's readers — and `test_files`
// how many vitest ran, absent where none reported.
const test_related_schema = z.object({
	kind: z.literal(KIND.TEST_RELATED),
	at: z.string(),
	scope: z.string(),
	changed: z.number(),
	synced: z.number(),
	since_map: z.number(),
	readers: z.number(),
	test_files: z.number().optional(),
	elapsed_ms: z.number(),
})
const entry_schema = z.discriminatedUnion('kind', [
	merge_schema,
	gate_schema,
	load_schema,
	dispatch_schema,
	stage_schema,
	stop_schema,
	overlap_schema,
	held_schema,
	released_schema,
	round_two_schema,
	offerable_schema,
	core_wait_schema,
	unit_files_schema,
	test_related_schema,
])

type LedgerEntry = z.infer<typeof entry_schema>
type MergeEntry = z.infer<typeof merge_schema>
type GateEntry = z.infer<typeof gate_schema>
type LoadEntry = z.infer<typeof load_schema>
type DispatchEntry = z.infer<typeof dispatch_schema>
type StageEntry = z.infer<typeof stage_schema>
type StopEntry = z.infer<typeof stop_schema>
type OverlapEntry = z.infer<typeof overlap_schema>
type HeldEntry = z.infer<typeof held_schema>
type RoundTwoEntry = z.infer<typeof round_two_schema>
type OfferableEntry = z.infer<typeof offerable_schema>
type CoreWaitEntry = z.infer<typeof core_wait_schema>
type CoreWaitRecord = Omit<CoreWaitEntry, 'kind' | 'at'>
type UnitFilesEntry = z.infer<typeof unit_files_schema>
type UnitFileRecord = z.infer<typeof unit_file_schema>
type TestRelatedEntry = z.infer<typeof test_related_schema>
type TestRelatedRecord = Omit<TestRelatedEntry, 'kind' | 'at'>
type RoundTwoRecord = Omit<RoundTwoEntry, 'kind' | 'at'>
// What a finished gate reports; the ledger stamps the kind and the time.
type GateRecord = Omit<GateEntry, 'kind' | 'at'>
type GateCheckRecord = z.infer<typeof check_schema>
type StageRecord = Omit<StageEntry, 'kind' | 'at'>
type StopRecord = Omit<StopEntry, 'kind' | 'at'>
type OverlapRecord = Omit<OverlapEntry, 'kind' | 'at'>

const lane_ledger_schema = { KIND, entry_schema }

export type {
	CoreWaitEntry,
	CoreWaitRecord,
	DispatchEntry,
	GateCheckRecord,
	GateEntry,
	GateRecord,
	HeldEntry,
	LedgerEntry,
	LoadEntry,
	MergeEntry,
	OfferableEntry,
	OverlapEntry,
	OverlapRecord,
	RoundTwoEntry,
	RoundTwoRecord,
	StageEntry,
	StageRecord,
	StopEntry,
	StopRecord,
	TestRelatedEntry,
	TestRelatedRecord,
	UnitFileRecord,
	UnitFilesEntry,
}
export { lane_ledger_schema }
