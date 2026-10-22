import { closeSync, constants, openSync, writeSync } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { stamped_memo } from '#scripts/lib/stamped-memo'
import { run_carry } from '#scripts/run/carry/run-carry'
import {
	lane_ledger_schema,
	type CoreWaitRecord,
	type GateRecord,
	type LedgerEntry,
	type OverlapRecord,
	type RoundTwoRecord,
	type StageRecord,
	type StopRecord,
	type TestRelatedRecord,
	type UnitFileRecord,
} from './lane-ledger-schema'

// The measurement ledger the lane limit is tuned against: one JSON line per
// lane merge, per finished `josh gate`, per machine-load sample, per lane dispatch, per finished
// `josh ship` stage, per stopped `josh ship`, per round-2 decision, per core-budget wait and per
// `josh test:related` run, read back by `josh lane:stats`. Each line's shape is `lane-ledger-schema.ts`.
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
// A detached `josh ship`'s fast checks in the agent's own turn — not a resumable ship stage, since the
// supervised gate runs them again (joshuafolkken/kit#4382).
const PRE_DETACH_STAGE = 'pre-detach'
const LEDGER_FILE_MODE = 0o600
// The flags `detached-launch.ts` appends its log with, for the same deterministic shared-temp path.
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_WRONLY } = constants
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const APPEND_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW

const { KIND, entry_schema } = lane_ledger_schema

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
// receiving it. Any JSON-lines log takes it — the durable review stop log too (joshuafolkken/kit#4519).
function append(path: string, entry: object): void {
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

async function record_offerable(is_offerable: boolean, path?: string): Promise<void> {
	await record({ kind: KIND.OFFERABLE, at: now_iso(), is_offerable }, path)
}

async function record_round_two(round_two: RoundTwoRecord, path?: string): Promise<void> {
	await record({ kind: KIND.ROUND_TWO, at: now_iso(), ...round_two }, path)
}

async function record_core_wait(wait: CoreWaitRecord, path?: string): Promise<void> {
	await record({ kind: KIND.CORE_WAIT, at: now_iso(), ...wait }, path)
}

async function record_unit_files(
	files: ReadonlyArray<UnitFileRecord>,
	path?: string,
): Promise<void> {
	await record({ kind: KIND.UNIT_FILES, at: now_iso(), files: [...files] }, path)
}

async function record_test_related(run: TestRelatedRecord, path?: string): Promise<void> {
	await record({ kind: KIND.TEST_RELATED, at: now_iso(), ...run }, path)
}

function parse_line(line: string): LedgerEntry | undefined {
	return entry_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(entry: LedgerEntry | undefined): entry is LedgerEntry {
	return entry !== undefined
}

function parse_entries(path: string): ReadonlyArray<LedgerEntry> {
	const raw = stamp_file.read_stamp_text(path)

	if (raw === undefined) return []

	return raw
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

// Each ledger's entries, parsed again only once the file itself has changed (joshuafolkken/kit#4263).
const parsed_ledgers = stamped_memo.create<ReadonlyArray<LedgerEntry>>()

// Every entry, oldest first. A malformed line — a write cut short — is skipped rather than making the
// whole ledger unreadable, and an absent or unowned file is an empty ledger.
function read_entries(path: string): ReadonlyArray<LedgerEntry> {
	return parsed_ledgers.of(path, stamped_memo.file_stamp(path), () => parse_entries(path))
}

const lane_ledger = {
	CI_WAIT_STAGE,
	KIND,
	PRE_DETACH_STAGE,
	append,
	read_entries,
	record,
	record_core_wait,
	record_dispatch,
	record_gate,
	record_held,
	record_released,
	record_merge,
	record_overlap,
	record_offerable,
	record_round_two,
	record_stage,
	record_stop,
	record_test_related,
	record_unit_files,
	target,
	target_of,
}

export type {
	CoreWaitEntry,
	CoreWaitRecord,
	DispatchEntry,
	GateCheckRecord,
	GateEntry,
	HeldEntry,
	LedgerEntry,
	LoadEntry,
	MergeEntry,
	OfferableEntry,
	OverlapEntry,
	OverlapRecord,
	RoundTwoEntry,
	StageEntry,
	StopEntry,
	StopRecord,
	TestRelatedEntry,
	TestRelatedRecord,
	UnitFileRecord,
	UnitFilesEntry,
} from './lane-ledger-schema'
export { lane_ledger }
