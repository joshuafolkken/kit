import {
	closeSync,
	constants,
	existsSync,
	fstatSync,
	openSync,
	readSync,
	statSync,
	truncateSync,
	writeSync,
} from 'node:fs'
import { repository_lock } from '#scripts/git/repository-lock'
import { stamp_file } from '#scripts/josh/stamp-file'
import { atomic_write } from '#scripts/lib/atomic-write'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { lane_ledger, type LedgerEntry } from './lane-ledger'
import { lane_ledger_write } from './lane-ledger-write'
import type { MeasureContext } from './lane-sampler'

// The ledger's records past the retention, moved to an archive beside it (joshuafolkken/kit#7038), so
// the ledger every lane step reads stays a few days long. **Merges stay**: they are a line per lane, and
// the baseline counts them across all time (`lane-baseline.ts`).
//
// **The ledger is replaced by a rename** — the tail reader (`lane-ledger-tail.ts`) reads another inode
// again whole. A descriptor stays open on the old ledger across the rename: bytes landing past the last
// complete line the rotation read are carried into the replacement, and an append that opened the old
// ledger before the rename is read back off that descriptor afterwards and carried too. The archive takes
// its lines in one append before the ledger is replaced, and a replace that throws truncates it back: a
// rotation cut short leaves each record in exactly one file. One rotation at a time, under a lock no
// rotation waits on.
//
// The readers of a lane's history — `josh lane:stats`, the per-issue `lane:net` / `lane:why` /
// `lane:breakdown` / `cost:audit` — read the archive before the ledger (`read_history`).

const RETENTION_DAYS = 14
const MS_PER_DAY = 86_400_000
const LEDGER_SUFFIX_PATTERN = /\.jsonl$/u
const ARCHIVE_SUFFIX = '-archive.jsonl'
const LOCK_SUFFIX = '.rotate.lock'
// The writer's own mode and flags (`lane-ledger-write.ts`), which takes one record, not lines of text.
const LEDGER_FILE_MODE = 0o600
const { O_APPEND, O_CREAT, O_NOFOLLOW, O_RDONLY, O_WRONLY } = constants
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const APPEND_FLAGS = O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const READ_FLAGS = O_RDONLY | O_NOFOLLOW
// One claim and no wait: a rotation already holding the lock does this one's work.
const NO_WAIT_MS = 0

const { LINE_SEPARATOR } = lane_ledger_write
const { KIND } = lane_ledger
const record_schema = z.looseObject({ kind: z.string(), at: z.string() })

type ReadContext = Pick<MeasureContext, 'ledger_path'>

interface Partition {
	readonly archived: string
	readonly count: number
	readonly kept: string
}

interface Move extends Partition {
	readonly descriptor: number
	readonly end: number
}

function archive_of(ledger: string): string {
	return `${ledger.replace(LEDGER_SUFFIX_PATTERN, '')}${ARCHIVE_SUFFIX}`
}

// Whether a line holds a record past the cutoff; a malformed line stays, as the reader skips it anyway.
function is_past(line: string, cutoff_ms: number): boolean {
	const record = record_schema.safeParse(json_value.parse_or_undefined(line)).data

	if (record === undefined || record.kind === KIND.MERGE) return false

	return Date.parse(record.at) < cutoff_ms
}

// `text` is complete lines only.
function partition(text: string, cutoff_ms: number): Partition {
	const archived: Array<string> = []
	const kept: Array<string> = []
	const lines = text.split(LINE_SEPARATOR).slice(0, -1)

	for (const line of lines) {
		const side = is_past(line, cutoff_ms) ? archived : kept

		side.push(`${line}${LINE_SEPARATOR}`)
	}

	return { archived: archived.join(''), count: archived.length, kept: kept.join('') }
}

// The bytes the descriptor's file holds past `from`.
function bytes_past(descriptor: number, from: number): Buffer {
	const buffer = Buffer.alloc(Math.max(fstatSync(descriptor).size - from, 0))
	const read = readSync(descriptor, buffer, 0, buffer.length, from)

	return buffer.subarray(0, read)
}

// One `O_APPEND` write to a file this account owns, never through a planted link.
function append_text(target: string, text: Uint8Array): void {
	const descriptor = openSync(target, APPEND_FLAGS, LEDGER_FILE_MODE)

	try {
		if (!stamp_file.is_own_regular_file(target)) {
			throw new Error(`Not an owned regular file: ${target}`)
		}

		writeSync(descriptor, text)
	} finally {
		closeSync(descriptor)
	}
}

function size_of(target: string): number {
	return existsSync(target) ? statSync(target).size : 0
}

// The old ledger's length the replacement carried.
function move(ledger: string, moved: Move): number {
	const archive = archive_of(ledger)
	const previous = size_of(archive)

	append_text(archive, Buffer.from(moved.archived))

	try {
		const landed = bytes_past(moved.descriptor, moved.end)

		atomic_write.replace_file(ledger, Buffer.concat([Buffer.from(moved.kept), landed]), {
			mode: LEDGER_FILE_MODE,
		})

		return moved.end + landed.length
	} catch (error) {
		truncateSync(archive, previous)
		throw error
	}
}

function rotate_open(ledger: string, descriptor: number, cutoff_ms: number): number {
	const read = bytes_past(descriptor, 0)
	const end = read.lastIndexOf(LINE_SEPARATOR) + 1
	const split = partition(read.toString('utf8', 0, end), cutoff_ms)

	if (split.count === 0) return 0

	const carried = move(ledger, { ...split, descriptor, end })
	const late = bytes_past(descriptor, carried)

	if (late.length > 0) append_text(ledger, late)

	return split.count
}

function rotate_held(ledger: string, cutoff_ms: number): number {
	const descriptor = openSync(ledger, READ_FLAGS)

	try {
		return rotate_open(ledger, descriptor, cutoff_ms)
	} finally {
		closeSync(descriptor)
	}
}

// The count of records moved: 0 when none is past the retention, the ledger is absent or not this
// account's, or another rotation holds the lock.
function rotate(ledger: string, now_ms: number = Date.now()): number {
	if (!existsSync(ledger) || !stamp_file.is_own_regular_file(ledger)) return 0

	const cutoff_ms = now_ms - RETENTION_DAYS * MS_PER_DAY
	const lock = `${ledger}${LOCK_SUFFIX}`

	return repository_lock.with_lock_sync(() => rotate_held(ledger, cutoff_ms), lock, NO_WAIT_MS) ?? 0
}

// This repository's ledger rotated; a test run has no ledger (`lane_ledger.target`).
async function rotate_target(): Promise<number> {
	const ledger = await lane_ledger.target()

	return ledger === undefined ? 0 : rotate(ledger)
}

// The archive's records, then the ledger's — every entry the ledger held before any rotation.
function history_at(ledger: string): ReadonlyArray<LedgerEntry> {
	return [...lane_ledger.read_entries(archive_of(ledger)), ...lane_ledger.read_entries(ledger)]
}

async function read_history(context: ReadContext): Promise<ReadonlyArray<LedgerEntry>> {
	const ledger = context.ledger_path ?? (await lane_ledger.target())

	return ledger === undefined ? [] : history_at(ledger)
}

const lane_ledger_archive = { archive_of, history_at, read_history, rotate, rotate_target }

export { lane_ledger_archive }
