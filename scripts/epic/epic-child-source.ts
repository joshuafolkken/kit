import { author_fields_schema } from '#scripts/git/git-schemas'
import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { z } from 'zod'
import type { EpicChild } from './epic-graph'
import { epic_issue } from './epic-issue'

// The children an epic read knows without asking (joshuafolkken/kit#6611): an open row the caller's
// listing returned in the same scan, and a closed child kept across scans — its state hardly ever
// changes, yet its issue and blocker reads were paid every scan. A read given no source reads all.

const HOURS_KEPT = 6
const MS_PER_HOUR = 3_600_000
// Long against a scan every few minutes, and short enough that a reopened child not in the listing
// is read as closed for part of a day at most — and none an open sibling waits on, which is read
// again (`epic-fetch.ts` `recheck_blockers`). One record, for the repository last written; another
// repository's write replaces it.
const CLOSED_CACHE: CacheSlot = { prefix: 'josh-epic-closed-', ttl_ms: HOURS_KEPT * MS_PER_HOUR }

const reference_schema = z.object({ repo: z.string(), number: z.number() })

const child_schema = z.object({
	number: z.number(),
	repo: z.string(),
	state: z.enum(['OPEN', 'CLOSED']),
	labels: z.array(z.string()),
	blocked_by: z.array(reference_schema),
	body: z.string().optional(),
	...author_fields_schema,
})

// Each child keeps its own read time, so adding another never extends how long it is trusted.
const entries_schema = z.array(z.object({ read_at: z.number(), child: child_schema }))

type ClosedEntry = z.infer<typeof entries_schema>[number]

// `listed` holds the open rows the caller's listing returned, all in `repo`.
interface ChildSource {
	repo: string
	listed: ReadonlyMap<number, EpicChild>
}

function fresh_entries(repo: string, now_ms: number): Array<ClosedEntry> {
	const entries = shared_cache.read(CLOSED_CACHE, repo, entries_schema, now_ms) ?? []

	return entries.filter((entry) => now_ms - entry.read_at < CLOSED_CACHE.ttl_ms)
}

function cached_closed(repo: string, now_ms: number): Map<number, EpicChild> {
	return new Map(fresh_entries(repo, now_ms).map((entry) => [entry.child.number, entry.child]))
}

// The children of `repo` answered without a read. A listed row wins over a cached closed one: the
// listing is open-only, so a child in it has been reopened since it was cached.
function known(
	source: ChildSource | undefined,
	repo: string,
	now_ms: number,
): ReadonlyMap<number, EpicChild> {
	if (source === undefined) return new Map()
	const closed = cached_closed(repo, now_ms)

	return source.repo === repo ? new Map([...closed, ...source.listed]) : closed
}

function is_closed(child: EpicChild): boolean {
	return child.state === epic_issue.CLOSED
}

// Adds the closed children just read to the record of `repo`, and drops a cached one that came back
// open. One already cached is left with its own read time.
function remember_closed(
	source: ChildSource | undefined,
	repo: string,
	children: ReadonlyArray<EpicChild>,
	now_ms: number,
): void {
	if (source === undefined) return
	const fresh = fresh_entries(repo, now_ms)
	const reopened = new Set(
		children.filter((child) => !is_closed(child)).map((child) => child.number),
	)
	const kept = fresh.filter((entry) => !reopened.has(entry.child.number))
	const cached = new Set(kept.map((entry) => entry.child.number))
	const added = children.filter((child) => is_closed(child) && !cached.has(child.number))

	if (added.length === 0 && kept.length === fresh.length) return
	const entries = [...kept, ...added.map((child) => ({ read_at: now_ms, child }))]

	shared_cache.write(CLOSED_CACHE, repo, entries, now_ms)
}

// The closed children `known` answered that an open sibling still waits on. Reopened, such a child
// must hold that sibling, so the record is not trusted for it.
function waited_closed(
	children: ReadonlyArray<EpicChild>,
	known_children: ReadonlyMap<number, EpicChild>,
	repo: string,
): ReadonlySet<number> {
	const waited = children
		.filter((child) => !is_closed(child))
		.flatMap((child) => child.blocked_by)
		.filter((blocker) => blocker.repo === repo)
		.map((blocker) => blocker.number)

	return new Set(waited.filter((number) => known_children.get(number)?.state === epic_issue.CLOSED))
}

const epic_child_source = { CLOSED_CACHE, known, remember_closed, waited_closed }

export type { ChildSource }
export { epic_child_source }
