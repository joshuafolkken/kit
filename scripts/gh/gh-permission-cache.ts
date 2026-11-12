import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { z } from 'zod'

// The logins a collaborator-permission read answered with a write role, kept across processes
// (joshuafolkken/kit#6613). Write access hardly ever changes, yet every `backlog:next` scan read it
// again for each `MEMBER` / `COLLABORATOR` author in the pool.
//
// **Only a write role is kept.** A refusal or a failed read is asked again by the next process, so an
// author granted access is trusted on the next scan rather than an hour later. The cost is the other
// direction: access revoked is still trusted for up to `MS_KEPT`. Only a caller that opts in reads this
// record (`Author.is_shared`): the auto-ok run gate (`auto-ok-author.ts`) accepts that window, and a
// caller that must see a revocation at once (`trusted-measure.ts`, `issue-body-or-comment.ts`) does not.

const MS_KEPT = 3_600_000
// One record, for the repository last written; another repository's write replaces it.
const WRITERS_CACHE: CacheSlot = { prefix: 'josh-write-permission-', ttl_ms: MS_KEPT }

// Each login keeps its own read time, so adding another never extends how long it is trusted.
const entries_schema = z.array(z.object({ login: z.string(), read_at: z.number() }))

type WriterEntry = z.infer<typeof entries_schema>[number]

function fresh_entries(repo: string, now_ms: number): Array<WriterEntry> {
	const entries = shared_cache.read(WRITERS_CACHE, repo, entries_schema, now_ms) ?? []

	return entries.filter((entry) => entry.read_at <= now_ms && now_ms - entry.read_at < MS_KEPT)
}

function is_writer(repo: string, login: string, now_ms: number = Date.now()): boolean {
	return fresh_entries(repo, now_ms).some((entry) => entry.login === login)
}

// Adds `login` to the record of `repo`; one already kept is left with its own read time.
function remember_writer(repo: string, login: string, now_ms: number = Date.now()): void {
	const fresh = fresh_entries(repo, now_ms)

	if (fresh.some((entry) => entry.login === login)) return

	shared_cache.write(WRITERS_CACHE, repo, [...fresh, { login, read_at: now_ms }], now_ms)
}

const gh_permission_cache = { WRITERS_CACHE, is_writer, remember_writer }

export { gh_permission_cache }
