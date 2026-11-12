import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'

// **The run event stream, read from where the previous read stopped** (joshuafolkken/kit#7258):
// `run:board` reads the stream every few seconds, and parsing all of it each time kept the board's
// worker holding and re-collecting the whole history. The reader keeps the events up to the last
// complete line and parses only the bytes past it.
//
// **Every write replaces the file**, so neither its inode nor its mtime says whether the old prefix
// survived: `append_held` rewrites through a rename, and its bound drops lines from the middle. The
// bytes just before the cached end are compared instead — each line carries a position no other line
// holds, so a dropped or replaced line shifts them and the read falls back to a whole read. A shorter
// file reads whole too.
//
// **A stream at `EVENT_CAP` reads whole once per write**: there every append drops a middle line, so
// the read after it fails the check. The ticks between writes still reuse the cache.

const FILE_START = 0
const NEWLINE = 0x0a
const NEXT_BYTE = 1
// The window compared before trusting the cached prefix: well past one event line.
const BOUNDARY_BYTES = 4096

// The parsed prefix: the events up to byte `bytes`, which ends on a line.
interface Kept {
	readonly bytes: number
	readonly events: ReadonlyArray<RunEvent>
}

interface TailCache extends Kept {
	readonly boundary: Buffer
}

const NOTHING_KEPT: Kept = { bytes: FILE_START, events: [] }
const caches = new Map<string, TailCache>()

// Only the bytes `readSync` reports, as `transcript-tail.ts` does: a short read leaves no NUL padding.
function read_range(descriptor: number, start: number, end: number): Buffer {
	const buffer = Buffer.alloc(Math.max(FILE_START, end - start))
	const read = readSync(descriptor, buffer, FILE_START, buffer.length, start)

	return buffer.subarray(FILE_START, read)
}

function boundary_of(descriptor: number, bytes: number): Buffer {
	return read_range(descriptor, Math.max(FILE_START, bytes - BOUNDARY_BYTES), bytes)
}

function is_prefix_kept(descriptor: number, size: number, cache?: TailCache): cache is TailCache {
	if (cache === undefined || size < cache.bytes) return false

	return boundary_of(descriptor, cache.bytes).equals(cache.boundary)
}

function events_in(chunk: Buffer, start: number, end?: number): ReadonlyArray<RunEvent> {
	return run_event_stream.events_of_text(chunk.subarray(start, end).toString('utf8'))
}

// Parses `kept.bytes..size` onto `kept.events`, caching up to the last complete line. A trailing line
// with no newline yet is parsed into this read but left out of the cache, so the next read parses it
// whole.
function settle(
	target: string,
	descriptor: number,
	size: number,
	kept: Kept,
): ReadonlyArray<RunEvent> {
	const chunk = read_range(descriptor, kept.bytes, size)
	const complete = chunk.lastIndexOf(NEWLINE) + NEXT_BYTE
	const events = [...kept.events, ...events_in(chunk, FILE_START, complete)]
	const bytes = kept.bytes + complete

	caches.set(target, { bytes, boundary: boundary_of(descriptor, bytes), events })

	const trailing = events_in(chunk, complete)

	return trailing.length === 0 ? events : [...events, ...trailing]
}

function read_open(target: string, descriptor: number): ReadonlyArray<RunEvent> {
	const { size } = fstatSync(descriptor)
	const cache = caches.get(target)

	if (!is_prefix_kept(descriptor, size, cache)) {
		return settle(target, descriptor, size, NOTHING_KEPT)
	}

	if (size === cache.bytes) return cache.events

	return settle(target, descriptor, size, cache)
}

function read_owned(target: string): ReadonlyArray<RunEvent> {
	const descriptor = openSync(target, 'r')

	try {
		return read_open(target, descriptor)
	} finally {
		closeSync(descriptor)
	}
}

/**
 * Every event on the stream, oldest first — the same answer as `run_event_stream.read_events`, read
 * incrementally. An absent, unowned or unreadable file is an empty stream and drops the cache.
 */
function read_events(target: string): ReadonlyArray<RunEvent> {
	try {
		if (stamp_file.is_own_regular_file(target)) return read_owned(target)
	} catch {
		// Falls through to the empty stream, as `stamp_file.read_stamp_text` does.
	}

	caches.delete(target)

	return []
}

const run_event_tail = { read_events }

export { run_event_tail }
