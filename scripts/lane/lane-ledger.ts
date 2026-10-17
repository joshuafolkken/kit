import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'

// The measurement ledger the lane limit is tuned against: one JSON line per
// lane merge, per finished `josh gate`, per machine-load sample, per lane dispatch, per finished
// `josh ship` stage and per stopped `josh ship`, read back by `josh lane:stats`.
//
// **Its own file rather than the run's event stream.** The stream is capped at 500 events and is
// rewritten whole on every append, which is right for "where is the run" and wrong for a measurement
// that spans days of one-a-minute load samples. This file is only ever appended to, so concurrent lanes
// never lose each other's lines to a read-modify-write race.
//
// **Keyed on the common git directory, the event stream's key**, so a lane child's gate, the parent's
// merge and the sampler all land in one ledger per repository. It sits in the temp root beside every
// other josh record; a reboot clears it, which is why `docs/maintainers/lane-limit-measurement.md`
// closes a period with `josh lane:stats` before one.

const LEDGER_PREFIX = 'josh-lane-ledger-'
const LEDGER_SUFFIX = '.jsonl'
const LINE_SEPARATOR = '\n'
// `followup`'s wait for CI — a stage of a lane's run that no `josh ship` stage is the whole of.
const CI_WAIT_STAGE = 'ci-wait'
const LEDGER_FILE_MODE = 0o600
// The flags `detached-launch.ts` appends its log with, for the same deterministic shared-temp path.
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } = constants
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const APPEND_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW

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
} as const

const merge_schema = z.object({ kind: z.literal(KIND.MERGE), at: z.string(), issue: z.number() })
const check_schema = z.object({
	label: z.string(),
	elapsed_ms: z.number(),
	is_passed: z.boolean(),
	is_reused: z.boolean().optional(),
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
// before it had one. How long it stayed stopped is derived from the next ship stage, not recorded, so a
// resumed ship never has to know the stop it ends.
const stop_schema = z.object({
	kind: z.literal(KIND.STOP),
	at: z.string(),
	issue: z.number(),
	reason: z.string(),
	cause: z.string().optional(),
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
// What a finished gate reports; the ledger stamps the kind and the time.
type GateRecord = Omit<GateEntry, 'kind' | 'at'>
type GateCheckRecord = z.infer<typeof check_schema>
type StageRecord = Omit<StageEntry, 'kind' | 'at'>
type StopRecord = Omit<StopEntry, 'kind' | 'at'>
type OverlapRecord = Omit<OverlapEntry, 'kind' | 'at'>

function target_of(repository: string): string {
	return stamp_file.stamp_path(LEDGER_PREFIX, repository, LEDGER_SUFFIX)
}

// The ledger of the repository this checkout belongs to, or `undefined` outside one. `git rev-parse`
// rejects outside a repository, and `josh gate` resolves this before it runs a check, so the rejection
// is read as "no ledger" rather than allowed to fail the gate it would only have measured.
//
// **A test run has no ledger either.** The writers sit on paths dozens of suites exercise — a ship
// stage, a dispatch, a `followup` — and one suite that forgot to mock this module would append its
// fixture durations to the real measurement; a test that writes passes its own path instead.
async function target(): Promise<string | undefined> {
	if (process.env['VITEST'] !== undefined) return undefined

	try {
		const repository = await run_carry.repository_directory()

		return repository === undefined ? undefined : target_of(repository)
	} catch {
		return undefined
	}
}

// **Append, never rewrite** — `O_APPEND` keeps each short line whole across concurrent writers, and
// `O_NOFOLLOW` plus `stamp_file`'s ownership test keep a planted link or another account's file from
// receiving it.
function append(path: string, entry: LedgerEntry): void {
	const descriptor = openSync(path, APPEND_FLAGS, LEDGER_FILE_MODE)

	try {
		if (stamp_file.is_own_regular_file(path)) {
			writeSync(descriptor, `${JSON.stringify(entry)}${LINE_SEPARATOR}`)
		}
	} finally {
		closeSync(descriptor)
	}
}

// Best-effort: a measurement must never fail the gate or the merge it measures, so every error — no
// repository, an unwritable temp root — is dropped.
async function record(entry: LedgerEntry, path?: string): Promise<void> {
	try {
		const destination = path ?? (await target())

		if (destination !== undefined) append(destination, entry)
	} catch {
		// Reporting is best-effort: a failed append is dropped rather than raised into the caller's work.
	}
}

function now_iso(): string {
	return new Date().toISOString()
}

// One finished `josh gate`, whether it passed or not — a failing gate cost the lane its time as well.
async function record_gate(path: string, gate: GateRecord): Promise<void> {
	await record({ kind: KIND.GATE, at: now_iso(), ...gate }, path)
}

async function record_merge(issue: number): Promise<void> {
	await record({ kind: KIND.MERGE, at: now_iso(), issue })
}

async function record_dispatch(issue: number, path?: string): Promise<void> {
	await record({ kind: KIND.DISPATCH, at: now_iso(), issue }, path)
}

async function record_stage(stage: StageRecord, path?: string): Promise<void> {
	await record({ kind: KIND.STAGE, at: now_iso(), ...stage }, path)
}

async function record_stop(stop: StopRecord, path?: string): Promise<void> {
	await record({ kind: KIND.STOP, at: now_iso(), ...stop }, path)
}

async function record_overlap(overlap: OverlapRecord, path?: string): Promise<void> {
	await record({ kind: KIND.OVERLAP, at: now_iso(), ...overlap }, path)
}

async function record_held(reason: string, path?: string): Promise<void> {
	await record({ kind: KIND.HELD, at: now_iso(), reason }, path)
}

async function record_released(path?: string): Promise<void> {
	await record({ kind: KIND.RELEASED, at: now_iso() }, path)
}

function parse_line(line: string): LedgerEntry | undefined {
	return entry_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(entry: LedgerEntry | undefined): entry is LedgerEntry {
	return entry !== undefined
}

// Every entry, oldest first. A malformed line — a write cut short — is skipped rather than making the
// whole ledger unreadable, and an absent or unowned file is an empty ledger.
function read_entries(path: string): ReadonlyArray<LedgerEntry> {
	const raw = stamp_file.read_stamp_text(path)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

const lane_ledger = {
	CI_WAIT_STAGE,
	KIND,
	append,
	read_entries,
	record,
	record_dispatch,
	record_gate,
	record_held,
	record_released,
	record_merge,
	record_overlap,
	record_stage,
	record_stop,
	target,
	target_of,
}

export type {
	DispatchEntry,
	GateCheckRecord,
	GateEntry,
	HeldEntry,
	LedgerEntry,
	LoadEntry,
	MergeEntry,
	OverlapEntry,
	OverlapRecord,
	StageEntry,
	StopEntry,
}
export { lane_ledger }
