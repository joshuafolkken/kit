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
	ROUND_ONE: 'round-one',
	ROUND_TWO: 'round-two',
	OFFERABLE: 'offerable',
	CORE_WAIT: 'core-wait',
	UNIT_FILES: 'unit-files',
	TEST_RELATED: 'test-related',
	TEST_PINNED: 'test-pinned',
	SPLIT_NOTICE: 'split-notice',
	SPLIT_FILED: 'split-filed',
	UNPLANNED_NOTICE: 'unplanned-notice',
	LANE_STATE: 'lane-state',
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
// `waiting` names the issues a `chain` / `gate` hold waited on (joshuafolkken/kit#4513).
const held_schema = z.object({
	kind: z.literal(KIND.HELD),
	at: z.string(),
	reason: z.string(),
	waiting: z.array(z.number()).optional(),
})
// The end of a hold no dispatch ended: every lane taken — one opened outside the driver included — or
// the run finished, so no free lane is owed a child any more.
const released_schema = z.object({ kind: z.literal(KIND.RELEASED), at: z.string() })
// A `lane:pause` (`paused`) or `lane:resume` (`running`) of `issue`'s lane, so a measurement reads the
// time its processes stood stopped (joshuafolkken/kit#5168) — the lane state file keeps only the last.
const lane_state_schema = z.object({
	kind: z.literal(KIND.LANE_STATE),
	at: z.string(),
	issue: z.number(),
	state: z.enum(['paused', 'running']),
})
// The round 1 a `josh ship` acted on for `issue`: `verdict` is the reviewer's — `clean`, `fixed`,
// `blocking` — or `reused` where a round recorded before the ship still described the tree, so the
// period's ship-time rounds that passed with no fix are counted (joshuafolkken/kit#4620).
const round_one_schema = z.object({
	kind: z.literal(KIND.ROUND_ONE),
	at: z.string(),
	issue: z.number(),
	verdict: z.string(),
})
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
// how many vitest ran, absent where none reported. `trigger_files` are the changed files that sent a
// full-suite run there, absent where none did and on rows written before it (joshuafolkken/kit#4510).
const test_related_schema = z.object({
	kind: z.literal(KIND.TEST_RELATED),
	at: z.string(),
	scope: z.string(),
	changed: z.number(),
	synced: z.number(),
	since_map: z.number(),
	readers: z.number(),
	test_files: z.number().optional(),
	trigger_files: z.array(z.string()).optional(),
	elapsed_ms: z.number(),
})
// One `josh test:pinned` run that probed (joshuafolkken/kit#5078): `held` hunks the verdict cache
// answered, and each probed hunk's `file`, the test files it ran (`tests`, absent where vitest wrote no
// report) and its wall time. `issue` is the lane it ran in, absent outside a lane. `rewired` counts the
// hunks not probed as an import moved under a new name (joshuafolkken/kit#5235), absent on older rows.
const test_pinned_probe_schema = z.object({
	file: z.string(),
	tests: z.number().optional(),
	elapsed_ms: z.number(),
})
const test_pinned_schema = z.object({
	kind: z.literal(KIND.TEST_PINNED),
	at: z.string(),
	issue: z.number().optional(),
	held: z.number(),
	rewired: z.number().optional(),
	probes: z.array(test_pinned_probe_schema),
	elapsed_ms: z.number(),
})
// The split notice shown to the lane of `issue`, with the measured diff it fired on — written once per
// Issue, by whichever of `josh lint:related`, `test:related` or `main:merge` showed it first
// (joshuafolkken/kit#4695).
const split_notice_schema = z.object({
	kind: z.literal(KIND.SPLIT_NOTICE),
	at: z.string(),
	issue: z.number(),
	files: z.number(),
	lines: z.number(),
})
// One `josh issue:file --route split` filed from the lane of `issue`; `child` is its reference.
const split_filed_schema = z.object({
	kind: z.literal(KIND.SPLIT_FILED),
	at: z.string(),
	issue: z.number(),
	child: z.string(),
})
// The ship's `unplanned` answer `josh check:related` printed to the lane of `issue` ahead of the ship,
// so a preflight `unplanned` stop after it is told apart in `lane:stats` (joshuafolkken/kit#5203).
const unplanned_notice_schema = z.object({
	kind: z.literal(KIND.UNPLANNED_NOTICE),
	at: z.string(),
	issue: z.number(),
	files: z.array(z.string()),
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
	round_one_schema,
	round_two_schema,
	offerable_schema,
	core_wait_schema,
	unit_files_schema,
	test_related_schema,
	test_pinned_schema,
	split_notice_schema,
	split_filed_schema,
	unplanned_notice_schema,
	lane_state_schema,
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
type RoundOneEntry = z.infer<typeof round_one_schema>
type RoundTwoEntry = z.infer<typeof round_two_schema>
type OfferableEntry = z.infer<typeof offerable_schema>
type CoreWaitEntry = z.infer<typeof core_wait_schema>
type CoreWaitRecord = Omit<CoreWaitEntry, 'kind' | 'at'>
type UnitFilesEntry = z.infer<typeof unit_files_schema>
type UnitFileRecord = z.infer<typeof unit_file_schema>
type TestRelatedEntry = z.infer<typeof test_related_schema>
type TestRelatedRecord = Omit<TestRelatedEntry, 'kind' | 'at'>
type TestPinnedEntry = z.infer<typeof test_pinned_schema>
type TestPinnedRecord = Omit<TestPinnedEntry, 'kind' | 'at'>
type SplitNoticeEntry = z.infer<typeof split_notice_schema>
type SplitNoticeRecord = Omit<SplitNoticeEntry, 'kind' | 'at'>
type SplitFiledEntry = z.infer<typeof split_filed_schema>
type SplitFiledRecord = Omit<SplitFiledEntry, 'kind' | 'at'>
type UnplannedNoticeEntry = z.infer<typeof unplanned_notice_schema>
type UnplannedNoticeRecord = Omit<UnplannedNoticeEntry, 'kind' | 'at'>
type LaneStateChangeEntry = z.infer<typeof lane_state_schema>
type LaneStateChangeRecord = Omit<LaneStateChangeEntry, 'kind' | 'at'>
type RoundOneRecord = Omit<RoundOneEntry, 'kind' | 'at'>
type RoundTwoRecord = Omit<RoundTwoEntry, 'kind' | 'at'>
// What a finished gate reports; the ledger stamps the kind and the time.
type GateRecord = Omit<GateEntry, 'kind' | 'at'>
type GateCheckRecord = z.infer<typeof check_schema>
type StageRecord = Omit<StageEntry, 'kind' | 'at'>
type StopRecord = Omit<StopEntry, 'kind' | 'at'>
type OverlapRecord = Omit<OverlapEntry, 'kind' | 'at'>
type HeldRecord = Omit<HeldEntry, 'kind' | 'at' | 'waiting'> & {
	waiting?: ReadonlyArray<number> | undefined
}

const lane_ledger_schema = { KIND, entry_schema }

export type {
	CoreWaitEntry,
	CoreWaitRecord,
	DispatchEntry,
	GateCheckRecord,
	GateEntry,
	GateRecord,
	HeldEntry,
	HeldRecord,
	LaneStateChangeEntry,
	LaneStateChangeRecord,
	LedgerEntry,
	LoadEntry,
	MergeEntry,
	OfferableEntry,
	OverlapEntry,
	OverlapRecord,
	RoundOneEntry,
	RoundOneRecord,
	RoundTwoEntry,
	RoundTwoRecord,
	SplitFiledEntry,
	SplitFiledRecord,
	SplitNoticeEntry,
	SplitNoticeRecord,
	StageEntry,
	StageRecord,
	StopEntry,
	StopRecord,
	TestPinnedEntry,
	TestPinnedRecord,
	TestRelatedEntry,
	TestRelatedRecord,
	UnitFileRecord,
	UnitFilesEntry,
	UnplannedNoticeEntry,
	UnplannedNoticeRecord,
}
export { lane_ledger_schema }
