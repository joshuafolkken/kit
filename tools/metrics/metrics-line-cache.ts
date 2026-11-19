import path from 'node:path'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import { file_reader } from '#scripts/lib/read-file'
import { z } from 'zod'
import { metrics_base_cache } from './metrics-base-cache'

// The code-line count of each file `metrics-code-lines.ts` already asked eslint for, so a run counts
// only the files that changed since one before it (joshuafolkken/kit#8205).
//
// **An entry is keyed by what decides the count and nothing else**: the file's extension (it picks the
// parser), the `max-lines` options eslint set on it and its text. The path and the tree are left out,
// so a merge-base measured in a throwaway tree (`base-tree.ts`) and every lane's checkout share the
// entries of the files they hold alike.
//
// **The record is one file per ruler**, the digest `metrics-base-cache.ts` keys the base reading by:
// the eslint configuration, the lockfile and every source the metrics command loads. A change to how
// a line is counted therefore opens an empty record, and every file is counted again.
//
// **A miss is the old path, never an error**: an unreadable file has no key and is counted, and a
// record another account owns or one that no longer parses reads as empty.

const CACHE_PREFIX = 'josh-metrics-lines-'
const KEY_SEPARATOR = '\n'

const record_schema = z.record(z.string(), z.number().int().nonnegative())

// Where the counts live: read once before counting, written once after it.
interface LineStore {
	load: () => ReadonlyMap<string, number>
	save: (entries: ReadonlyMap<string, number>) => void
}

function entry_key(file: string, options: unknown): string | undefined {
	const text = file_reader.read_if_readable(file)

	if (text === undefined) return undefined

	const parts = [path.extname(file), JSON.stringify(options), text]

	return stamp_file.digest(parts.join(KEY_SEPARATOR))
}

function read_record(target: string): ReadonlyMap<string, number> {
	const text = stamp_file.read_stamp_text(target)
	const parsed = text === undefined ? undefined : json_value.parse_or_undefined(text)

	return new Map(Object.entries(record_schema.safeParse(parsed).data ?? {}))
}

// The record as it stands now, so entries another run wrote since this one loaded are kept.
// Best-effort: a record that could not be written costs the next run its counts, never this one.
function write_record(target: string, entries: ReadonlyMap<string, number>): void {
	if (entries.size === 0) return

	const merged = new Map([...read_record(target), ...entries])

	try {
		stamp_file.replace_stamp(target, Object.fromEntries(merged))
	} catch {
		// A lost record is counted again next time.
	}
}

function file_store(target: string): LineStore {
	return {
		load: (): ReadonlyMap<string, number> => read_record(target),
		save: (entries): void => {
			write_record(target, entries)
		},
	}
}

// `ruler_root` is the checkout whose configuration counts every tree, never the tree counted.
function cache_path(ruler_root: string): string {
	return stamp_file.stamp_path(CACHE_PREFIX, metrics_base_cache.ruler_digest(ruler_root))
}

function ruler_store(ruler_root: string): LineStore {
	return file_store(cache_path(ruler_root))
}

// Counts every file afresh, for a caller that measures the counting itself.
const no_store: LineStore = {
	load: (): ReadonlyMap<string, number> => new Map(),
	save: (): void => undefined,
}

const metrics_line_cache = { cache_path, entry_key, file_store, no_store, ruler_store }

export type { LineStore }
export { metrics_line_cache }
