import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { run_carry } from '#scripts/run/carry/run-carry'
import { z } from 'zod'

// The measurement ledger the lane limit is tuned against: one JSON line per
// lane merge, per finished `josh gate`, and per machine-load sample, read back by `josh lane:stats`.
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
const LEDGER_FILE_MODE = 0o600
// The flags `detached-launch.ts` appends its log with, for the same deterministic shared-temp path.
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } = constants
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const APPEND_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW

const KIND = { MERGE: 'merge', GATE: 'gate', LOAD: 'load' } as const

const merge_schema = z.object({ kind: z.literal(KIND.MERGE), at: z.string(), issue: z.number() })
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
})
// `swap_mb` and `lanes` are optional because either read can fail on its own — a platform with no
// swap reading, a `git worktree` call that did not answer — and a sample is still worth its load.
const load_schema = z.object({
	kind: z.literal(KIND.LOAD),
	at: z.string(),
	load: z.number(),
	free_mb: z.number(),
	swap_mb: z.number().optional(),
	lanes: z.number().optional(),
})
const entry_schema = z.discriminatedUnion('kind', [merge_schema, gate_schema, load_schema])

type LedgerEntry = z.infer<typeof entry_schema>
type MergeEntry = z.infer<typeof merge_schema>
type GateEntry = z.infer<typeof gate_schema>
type LoadEntry = z.infer<typeof load_schema>
// What a finished gate reports; the ledger stamps the kind and the time.
type GateRecord = Omit<GateEntry, 'kind' | 'at'>

function target_of(repository: string): string {
	return stamp_file.stamp_path(LEDGER_PREFIX, repository, LEDGER_SUFFIX)
}

// The ledger of the repository this checkout belongs to, or `undefined` outside one. `git rev-parse`
// rejects outside a repository, and `josh gate` resolves this before it runs a check, so the rejection
// is read as "no ledger" rather than allowed to fail the gate it would only have measured.
async function target(): Promise<string | undefined> {
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
	KIND,
	append,
	read_entries,
	record,
	record_gate,
	record_merge,
	target,
	target_of,
}

export type { GateEntry, LedgerEntry, LoadEntry, MergeEntry }
export { lane_ledger }
