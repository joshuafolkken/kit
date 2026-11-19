import { closeSync, constants, fstatSync, openSync, readSync, type Stats } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { lane_ledger_schema, type LedgerEntry } from './lane-ledger-schema'
import { lane_ledger_write } from './lane-ledger-write'

// The ledger read by its tail: the writer only appends, so a read after an append parses the bytes
// past the last complete line it already parsed, not the whole file again (joshuafolkken/kit#7012).
// Another inode, a shrink, or a change that kept the size is a replaced file, read again whole.

interface Snapshot {
	readonly ino: number
	readonly size: number
	readonly mtime_ms: number
}

type Tail = Snapshot & {
	// Bytes through the last line separator: everything before it is parsed into `lines`.
	readonly offset: number
	readonly lines: ReadonlyArray<LedgerEntry>
	// `lines` and the fragment after the offset — a write cut short, or one still landing — parsed
	// on each read and never kept, so it counts once it is complete.
	readonly entries: ReadonlyArray<LedgerEntry>
}

const { entry_schema } = lane_ledger_schema
const { LINE_SEPARATOR } = lane_ledger_write
const EMPTY: ReadonlyArray<LedgerEntry> = []
const { O_NOFOLLOW, O_RDONLY } = constants
// The writer's `O_NOFOLLOW` (`lane-ledger-write.ts`), so a planted link is never read.
// eslint-disable-next-line no-bitwise -- POSIX open flags are a bit field; `||` here would be a bug
const READ_FLAGS = O_RDONLY | O_NOFOLLOW

function parse_line(line: string): LedgerEntry | undefined {
	return entry_schema.safeParse(json_value.parse_or_undefined(line)).data
}

function is_present(entry: LedgerEntry | undefined): entry is LedgerEntry {
	return entry !== undefined
}

// A malformed line — a write cut short — is skipped rather than making the whole ledger unreadable.
function parse_text(text: string): Array<LedgerEntry> {
	return text
		.split(LINE_SEPARATOR)
		.map((line) => parse_line(line.trim()))
		.filter(is_present)
}

function snapshot_of(stat: Stats): Snapshot {
	return { ino: stat.ino, size: stat.size, mtime_ms: stat.mtimeMs }
}

function is_unchanged(previous: Tail, snapshot: Snapshot): boolean {
	const { ino, size, mtime_ms } = snapshot

	return previous.ino === ino && previous.size === size && previous.mtime_ms === mtime_ms
}

// The tail to grow from: the previous read while the same file only grew, else none — a full read.
function base_of(previous: Tail | undefined, snapshot: Snapshot): Tail | undefined {
	if (previous === undefined) return undefined

	return previous.ino === snapshot.ino && previous.size < snapshot.size ? previous : undefined
}

// The entries a store keeps; the others are parsed and dropped (joshuafolkken/kit#8034).
type Keep = (entry: LedgerEntry) => boolean

interface Growth {
	readonly base: Tail | undefined
	readonly from: number
	readonly bytes: Buffer
	readonly is_kept: Keep
}

function grow(snapshot: Snapshot, growth: Growth): Tail {
	const { base, from, bytes, is_kept } = growth
	const end = bytes.lastIndexOf(LINE_SEPARATOR) + 1
	const parsed = parse_text(bytes.toString('utf8', 0, end)).filter((entry) => is_kept(entry))
	const lines = [...(base?.lines ?? EMPTY), ...parsed]
	const fragment = parse_text(bytes.toString('utf8', end)).filter((entry) => is_kept(entry))
	const entries = fragment.length === 0 ? lines : [...lines, ...fragment]

	return { ...snapshot, size: from + bytes.length, offset: from + end, lines, entries }
}

function next_tail(
	descriptor: number,
	snapshot: Snapshot,
	previous: Tail | undefined,
	is_kept: Keep,
): Tail {
	if (previous !== undefined && is_unchanged(previous, snapshot)) return previous

	const base = base_of(previous, snapshot)
	const from = base?.offset ?? 0
	const bytes = Buffer.alloc(snapshot.size - from)
	const length = readSync(descriptor, bytes, 0, bytes.length, from)

	return grow(snapshot, { base, from, bytes: bytes.subarray(0, length), is_kept })
}

// `undefined` for an absent, unowned or unreadable file: an empty ledger.
function with_ledger<T>(path: string, read_open: (descriptor: number) => T): T | undefined {
	try {
		if (!stamp_file.is_own_regular_file(path)) return undefined

		const descriptor = openSync(path, READ_FLAGS)

		try {
			return read_open(descriptor)
		} finally {
			closeSync(descriptor)
		}
	} catch {
		return undefined
	}
}

function read_tail(path: string, previous: Tail | undefined, is_kept: Keep): Tail | undefined {
	return with_ledger(path, (descriptor) =>
		next_tail(descriptor, snapshot_of(fstatSync(descriptor)), previous, is_kept),
	)
}

interface TailStore {
	// The kept entries, oldest first; the same array while the file is unchanged, so a reader can key
	// its own aggregation on it.
	readonly read: (path: string) => ReadonlyArray<LedgerEntry>
	// Lets go of the path's kept entries; the next read parses the whole file again.
	readonly forget: (path: string) => void
}

function is_any(): boolean {
	return true
}

// The tails read so far, by path, holding only the entries `is_kept` passes — a reader that needs a
// few kinds keeps those, not the whole ledger (joshuafolkken/kit#8034).
function tail_store(is_kept: Keep = is_any): TailStore {
	const tails = new Map<string, Tail>()

	function read(path: string): ReadonlyArray<LedgerEntry> {
		const tail = read_tail(path, tails.get(path), is_kept)

		if (tail === undefined) {
			tails.delete(path)

			return EMPTY
		}

		tails.set(path, tail)

		return tail.entries
	}

	function forget(path: string): void {
		tails.delete(path)
	}

	return { read, forget }
}

const every_entry = tail_store()

// The recent window read backward from the end (joshuafolkken/kit#7930): a fresh process reads only the
// chunks covering the window, not the whole ledger. `reached_start` — the ledger's start was read with
// no line older than the window by the margin met, so the window may reach past it.
interface RecentWindow {
	readonly entries: ReadonlyArray<LedgerEntry>
	readonly reached_start: boolean
}

const CHUNK_BYTES = 65_536
// The ledger is not strictly in time order: a merge line is dated back to its ship's report, minutes
// before it lands (`run-merge-dated.ts`), so the scan stops only past this margin.
const BACKDATE_MARGIN_MS = 3_600_000
const NONE: RecentWindow = { entries: EMPTY, reached_start: true }

function read_range(descriptor: number, start: number, end: number): Buffer {
	const bytes = Buffer.alloc(end - start)

	return bytes.subarray(0, readSync(descriptor, bytes, 0, bytes.length, start))
}

// Where the chunk's first complete line starts: its head may be a line cut by the chunk boundary,
// carried into the chunk before it — unless the chunk starts the file.
function first_line_at(bytes: Buffer, is_file_start: boolean): number {
	if (is_file_start) return 0

	const index = bytes.indexOf(LINE_SEPARATOR)

	return index === -1 ? bytes.length : index + 1
}

function is_since(entry: LedgerEntry, since_ms: number): boolean {
	return Date.parse(entry.at) >= since_ms
}

// Adds the text's entries in the window to `found`, newest first; true once a line older than the
// window by more than the backdate margin is met — no line before it can still fall in the window.
function take_newest(found: Array<LedgerEntry>, text: string, since_ms: number): boolean {
	const newest_first = parse_text(text).toReversed()
	const stop = newest_first.findIndex((entry) => !is_since(entry, since_ms - BACKDATE_MARGIN_MS))
	const scanned = stop === -1 ? newest_first : newest_first.slice(0, stop)

	found.push(...scanned.filter((entry) => is_since(entry, since_ms)))

	return stop !== -1
}

interface Scan {
	readonly descriptor: number
	readonly since_ms: number
	readonly chunk_bytes: number
	readonly found: Array<LedgerEntry>
}

// The bytes still to read: through `end`, then `carry` — a line the later chunk's boundary cut.
interface Cursor {
	readonly end: number
	readonly carry: Buffer
}

// One chunk back: the cursor before it, or `undefined` once a line older than the window is met.
function step_back(scan: Scan, cursor: Cursor): Cursor | undefined {
	const start = Math.max(0, cursor.end - scan.chunk_bytes)
	const bytes = Buffer.concat([read_range(scan.descriptor, start, cursor.end), cursor.carry])
	const cut = first_line_at(bytes, start === 0)

	if (take_newest(scan.found, bytes.toString('utf8', cut), scan.since_ms)) return undefined

	return { end: start, carry: bytes.subarray(0, cut) }
}

function scan_back(
	descriptor: number,
	since_ms: number,
	chunk_bytes: number,
	end = fstatSync(descriptor).size,
): RecentWindow {
	const scan: Scan = { descriptor, since_ms, chunk_bytes, found: [] }
	let cursor: Cursor | undefined = { end, carry: Buffer.alloc(0) }

	while (cursor !== undefined && cursor.end > 0) cursor = step_back(scan, cursor)

	return { entries: scan.found.toReversed(), reached_start: cursor !== undefined }
}

// The entries at or after `since_ms`, oldest first; malformed lines skipped as `read` skips them.
function read_since(path: string, since_ms: number, chunk_bytes = CHUNK_BYTES): RecentWindow {
	return with_ledger(path, (descriptor) => scan_back(descriptor, since_ms, chunk_bytes)) ?? NONE
}

// joshuafolkken/kit#8133: a window a long-lived reader asks for again and again, while the ledger is
// appended every few seconds — read backward once from its oldest start, then grown by the appended
// bytes alone, as a tail is. An earlier start, another inode, a shrink or a change that kept the size
// reads the window backward again.
interface Window {
	readonly since_ms: number
	readonly tail: Tail
}

// Bytes through the file's last line separator, sought a chunk at a time from the end: the window read
// backward ends on a complete line, and the line still landing after it — however long — is parsed as
// a tail's fragment is.
function line_end(descriptor: number, size: number): number {
	let end = size

	while (end > 0) {
		const start = Math.max(0, end - CHUNK_BYTES)
		const index = read_range(descriptor, start, end).lastIndexOf(LINE_SEPARATOR)

		if (index !== -1) return start + index + 1
		end = start
	}

	return 0
}

function seed(descriptor: number, snapshot: Snapshot, since_ms: number, is_kept: Keep): Window {
	const offset = line_end(descriptor, snapshot.size)
	const { entries } = scan_back(descriptor, since_ms, CHUNK_BYTES, offset)
	const lines = entries.filter((entry) => is_kept(entry))
	const read: Tail = { ...snapshot, size: offset, offset, lines, entries: lines }

	return { since_ms, tail: next_tail(descriptor, snapshot, read, is_kept) }
}

function is_growable(window: Window, snapshot: Snapshot, since_ms: number): boolean {
	if (since_ms < window.since_ms) return false

	return is_unchanged(window.tail, snapshot) || base_of(window.tail, snapshot) !== undefined
}

function next_window(
	descriptor: number,
	previous: Window | undefined,
	since_ms: number,
	is_kept: Keep,
): Window {
	const snapshot = snapshot_of(fstatSync(descriptor))

	if (previous === undefined || !is_growable(previous, snapshot, since_ms)) {
		return seed(descriptor, snapshot, since_ms, is_kept)
	}

	return {
		since_ms: previous.since_ms,
		tail: next_tail(descriptor, snapshot, previous.tail, is_kept),
	}
}

interface WindowStore {
	// The kept entries at or after `since_ms`, oldest first; an absent or unreadable file has none.
	readonly read: (path: string, since_ms: number) => ReadonlyArray<LedgerEntry>
}

function window_store(is_kept: Keep = is_any): WindowStore {
	const windows = new Map<string, Window>()

	function read(path: string, since_ms: number): ReadonlyArray<LedgerEntry> {
		const window = with_ledger(path, (descriptor) =>
			next_window(descriptor, windows.get(path), since_ms, is_kept),
		)

		if (window === undefined) {
			windows.delete(path)

			return EMPTY
		}

		windows.set(path, window)

		return window.tail.entries.filter((entry) => is_since(entry, since_ms))
	}

	return { read }
}

const lane_ledger_tail = { read: every_entry.read, read_since, tail_store, window_store }

export type { RecentWindow, TailStore, WindowStore }
export { lane_ledger_tail }
