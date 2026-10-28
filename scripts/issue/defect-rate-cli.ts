import { shared_cache, type CacheSlot } from '#scripts/josh/shared-cache'
import { z } from 'zod'
import { defect_rate, type DefectRate } from './defect-rate'
import { issue_search } from './issue-search'

const MS_PER_MINUTE = 60_000
const CACHE_TTL_MINUTES = 15
// A 14-day rate does not move within a quarter of an hour, and every `backlog:next` / `backlog:plan`
// a backlogrun's drive, probe and board make asks it — each costing two or more search requests
// against the 30-a-minute limit (joshuafolkken/kit#4550).
const RATE_CACHE: CacheSlot = {
	prefix: 'josh-defect-rate-',
	ttl_ms: CACHE_TTL_MINUTES * MS_PER_MINUTE,
}

const defect_rate_schema = z.object({
	days: z.number(),
	since: z.string(),
	defects: z.number(),
	enhancements: z.number(),
	is_capped: z.boolean(),
})

async function measure_uncached(
	repo: string,
	days: number,
	since: string,
): Promise<DefectRate | undefined> {
	const [filed, completed] = await Promise.all([
		issue_search.search(defect_rate.filed_query(repo, since)),
		issue_search.search(defect_rate.completed_query(repo, since)),
	])

	if (filed === undefined || completed === undefined) return undefined

	const is_capped = filed.is_capped || completed.is_capped

	return defect_rate.measure({
		days,
		since,
		filed: filed.issues,
		completed: completed.issues,
		is_capped,
	})
}

// The rate over a window, or `undefined` when either search could not be read. `backlog:next` asks it.
// Shared across processes for `CACHE_TTL_MINUTES`; an unread rate is not kept.
async function measure_window(
	repo: string,
	days: number,
	now_ms: number,
): Promise<DefectRate | undefined> {
	const since = defect_rate.window_start(now_ms, days)
	const key = [repo, String(days), since].join(' ')

	return await shared_cache.remember(
		{ slot: RATE_CACHE, key, schema: defect_rate_schema },
		async () => await measure_uncached(repo, days, since),
		now_ms,
	)
}

const defect_rate_cli = { RATE_CACHE, measure_window }

export { defect_rate_cli }
