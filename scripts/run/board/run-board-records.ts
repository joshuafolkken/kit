import { lstatSync } from 'node:fs'
import path from 'node:path'
import { lane_state, type LaneStateRecord } from '#scripts/lane/lane-state'
import { lane_state_record } from '#scripts/lane/lane-state-record'

// Every lane record, as `lane_state.read_records` reads them, for the live board's tick.
//
// **A record whose file is unchanged is not re-read**: the records outlive their lanes, so nearly all
// are ended and never written again, yet the board re-read and re-parsed each one every tick
// ([joshuafolkken/kit#7257](https://github.com/joshuafolkken/kit/issues/7257)). A file is unchanged
// when its inode, modified time and size match the last tick's — `stamp_file.replace_stamp` renames a
// new file over the record, so every write moves the inode too.
//
// **The cache is rebuilt from each tick's listing**, so a record removed from disk leaves it at once
// and it never holds more entries than the directory has records.

interface Cached {
	stamp: string
	record: LaneStateRecord | undefined
}

const caches = new Map<string, Map<string, Cached>>()

function stamp_of(file: string): string | undefined {
	const stats = lstatSync(file, { throwIfNoEntry: false })

	return stats === undefined ? undefined : [stats.ino, stats.mtimeMs, stats.size].join(':')
}

function read_one(file: string, previous: Cached | undefined): Cached | undefined {
	const stamp = stamp_of(file)

	if (stamp === undefined) return undefined
	if (previous?.stamp === stamp) return previous

	return { stamp, record: lane_state_record.read_record_file(file) }
}

// The folder is resolved once a tick: `state_path` makes sure it exists on every call, which across
// every record cost more than the reads the cache saves.
function refreshed(directory: string, held: ReadonlyMap<string, Cached>): Map<string, Cached> {
	const folder = path.dirname(lane_state.state_path(directory, ''))
	const next = new Map<string, Cached>()

	for (const issue of lane_state.recorded_issues(directory)) {
		const file = path.join(folder, lane_state_record.record_name(directory, issue))
		const entry = read_one(file, held.get(issue))

		if (entry !== undefined) next.set(issue, entry)
	}

	return next
}

/** Every lane record of `directory`, re-reading only the files changed since the last call. */
function read_records(directory: string): Array<LaneStateRecord> {
	const next = refreshed(directory, caches.get(directory) ?? new Map<string, Cached>())

	caches.set(directory, next)

	return [...next.values()].flatMap(({ record }) => (record === undefined ? [] : [record]))
}

/** How many records the cache holds for `directory`. */
function cached_count(directory: string): number {
	return caches.get(directory)?.size ?? 0
}

function clear(): void {
	caches.clear()
}

const run_board_records = {
	cached_count,
	clear,
	read_records,
}

export { run_board_records }
