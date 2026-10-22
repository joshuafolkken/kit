import { git_common_directory } from '#scripts/git/git-common-directory'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { json_value } from '#scripts/lib/json-value'
import { z } from 'zod'
import { stamp_file } from './stamp-file'

// An answer one josh process read from GitHub, kept for the next process to reuse while it is fresh
// (joshuafolkken/kit#4550).
//
// **Keyed to the repository's common git directory, so every work tree shares one record.** A
// backlogrun asks the same question from its drive, its arrival probe and every lane at once; keying on
// `PROJECT_ROOT` would give each work tree its own copy and each would read GitHub again.
//
// One record per slot: a different `key` replaces it rather than accumulating beside it, so the temp
// directory holds at most one file per slot however many keys a run walks through.

interface CacheSlot {
	prefix: string
	ttl_ms: number
}

const record_schema = z.object({
	key: z.string(),
	saved_at: z.number(),
	value: z.unknown(),
})

function slot_path(slot: CacheSlot): string {
	return stamp_file.stamp_path(slot.prefix, git_common_directory.repository() ?? PROJECT_ROOT)
}

function is_fresh(saved_at: number, slot: CacheSlot, now_ms: number): boolean {
	return saved_at <= now_ms && now_ms - saved_at < slot.ttl_ms
}

function read_value(slot: CacheSlot, key: string, now_ms: number): unknown {
	const raw = stamp_file.read_stamp_text(slot_path(slot))
	const record = raw === undefined ? undefined : json_value.parse_with(raw, record_schema)

	return record?.key === key && is_fresh(record.saved_at, slot, now_ms) ? record.value : undefined
}

// `undefined` is a miss: no record, another key's record, a stale one, or one that does not parse.
function read<T>(
	slot: CacheSlot,
	key: string,
	schema: z.ZodType<T>,
	now_ms: number,
): T | undefined {
	const parsed = schema.safeParse(read_value(slot, key, now_ms))

	return parsed.success ? parsed.data : undefined
}

// A write that fails leaves the next process to read GitHub itself — the answer this process already
// has is still right, so the failure is not its caller's to handle.
function write(slot: CacheSlot, key: string, value: unknown, now_ms: number): void {
	try {
		stamp_file.replace_stamp(slot_path(slot), { key, saved_at: now_ms, value })
	} catch {
		// The record is an optimization; a missing one costs one read.
	}
}

// The cached answer for `key`, or `compute`'s — stored only when it is defined, so a failed read is
// asked again by the next process rather than remembered for the whole TTL.
async function remember<T>(
	request: { slot: CacheSlot; key: string; schema: z.ZodType<T> },
	compute: () => Promise<T | undefined>,
	now_ms: number = Date.now(),
): Promise<T | undefined> {
	const cached = read(request.slot, request.key, request.schema, now_ms)

	if (cached !== undefined) return cached

	const value = await compute()

	if (value !== undefined) write(request.slot, request.key, value, now_ms)

	return value
}

function clear(slot: CacheSlot): void {
	stamp_file.remove_stamp(slot_path(slot))
}

const shared_cache = { clear, read, remember, write }

export { shared_cache }
export type { CacheSlot }
