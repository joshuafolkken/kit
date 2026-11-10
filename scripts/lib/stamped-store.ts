import { z } from 'zod'
import { atomic_write } from './atomic-write'
import { json_value } from './json-value'
import { file_reader } from './read-file'
import { stamped_memo, type StampedMemo } from './stamped-memo'

// A `stamped_memo` kept in a JSON file, so the next process reuses the answers whose stamps still hold
// (joshuafolkken/kit#7134).
//
// **`version` names how the answers were computed.** A file written under another version, or one that
// does not parse against `schema`, opens empty, so a changed computation reads everything again rather
// than mixing old answers with new ones. **It never fails its caller**: an unreadable file opens empty
// and an unwritable one is left as it was.

interface Remembered<Value> {
	stamp: string
	value: Value
}

interface StampedStore<Value> extends StampedMemo<Value> {
	// Write every answer the store holds, replacing the file atomically.
	save: () => void
}

function stored_schema<Value>(schema: z.ZodType<Value>): z.ZodType<{
	version: string
	entries: Array<[string, Remembered<Value>]>
}> {
	const remembered = z.object({ stamp: z.string(), value: schema })
	const entry = z.tuple([z.string(), remembered])

	return z.object({ version: z.string(), entries: z.array(entry) })
}

function load<Value>(
	file: string,
	version: string,
	schema: z.ZodType<Value>,
): Map<string, Remembered<Value>> {
	const text = file_reader.read_if_readable(file) ?? ''
	const stored = json_value.parse_with(text, stored_schema(schema))

	return new Map(stored?.version === version ? stored.entries : [])
}

function write(file: string, version: string, entries: Map<string, Remembered<unknown>>): void {
	try {
		atomic_write.replace_file(file, JSON.stringify({ version, entries: [...entries] }))
	} catch {
		// Unwritable: the next process reads everything again, which is the reading without a store.
	}
}

// The memo answers; `known` mirrors it so `save` has the entries to write.
function open<Value>(file: string, version: string, schema: z.ZodType<Value>): StampedStore<Value> {
	const memo = stamped_memo.create<Value>()
	const known = load(file, version, schema)

	for (const [key, { stamp, value }] of known) memo.of(key, stamp, () => value)

	return {
		of(key, stamp, compute) {
			const value = memo.of(key, stamp, compute)

			known.set(key, { stamp, value })

			return value
		},
		keep(keys) {
			memo.keep(keys)
			for (const key of known.keys()) if (!keys.has(key)) known.delete(key)
		},
		save: () => write(file, version, known),
	}
}

const stamped_store = { open }

export { stamped_store }
export type { StampedStore }
