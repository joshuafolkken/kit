import type { CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'

// A short reuse window over the transcript-priced verdict `implementation-cut.ts` reads
// (joshuafolkken/kit#2385).
//
// **The read is a whole-transcript price and its caller is asked of every edit.**
// `is_over_threshold_edit` reads `cost_cli.session_verdict` — which loads and parses the session
// corpus — and it is asked of every `Edit` / `Write` a lane child makes. Once the row fires per
// threshold crossing rather than once per run, that read can no longer be paid on every edit, so the
// verdict is cached beside the instant it was read and a burst of edits shares one read.
//
// **An in-memory memo cannot span two edits.** `pnpm josh rule:guard` runs as a fresh process on each
// `PreToolUse`, so the cache is a per-checkout stamp rather than a module variable — the same handoff
// shape the refusal stamp itself uses.
//
// **The value cannot go stale inside a window this short.** A turn appends no new *request* record
// between its own edits, so consecutive edits of one turn price identically; and a cut relaunches the
// process, whose first edit lands far past the window, so a resumed under-threshold session never reads
// a stale `over` left by the process the cut ended.

const VERDICT_CACHE_PREFIX = 'josh-impl-cut-verdict-'
// Long enough to collapse one turn's burst of edits to a single read, short enough that the next turn
// re-reads as the context grows. It sits below the cut-relaunch latency by design (see the header).
const VERDICT_REUSE_MS = 5000

// The literal spellings, tied to `CostVerdict` by `satisfies` so a change to the union fails this line
// rather than drifting silently — the namespace constants (`cost_verdict.OVER_VERDICT` …) widen to
// `string` through the object, so they cannot type a `z.enum` tuple.
const VERDICT_VALUES = [
	'over',
	'under',
	'unmeasurable',
] as const satisfies ReadonlyArray<CostVerdict>
const cache_schema = z.object({ read_at_ms: z.number(), verdict: z.enum(VERDICT_VALUES) })

function cache_path(directory: string): string {
	return stamp_file.stamp_path(VERDICT_CACHE_PREFIX, directory)
}

// The stored verdict when it is still inside the reuse window, or `undefined` for a missing, expired or
// unreadable record — every one of which is a cache miss that reads afresh.
function cached_verdict(target: string, now_ms: number): CostVerdict | undefined {
	const raw = stamp_file.read_stamp_text(target)

	if (raw === undefined) return undefined

	try {
		const { read_at_ms, verdict } = cache_schema.parse(JSON.parse(raw))

		return now_ms - read_at_ms < VERDICT_REUSE_MS ? verdict : undefined
	} catch {
		return undefined
	}
}

// The verdict, read through the window: the stored value inside it, a fresh `read()` past it. The
// fresh read rewrites the stamp so the window restarts, and `replace_stamp`'s atomic rename keeps two
// edits racing the write from tearing the record.
function reused_verdict(
	read: () => CostVerdict,
	directory: string = process.cwd(),
	now_ms: number = Date.now(),
): CostVerdict {
	const target = cache_path(directory)
	const cached = cached_verdict(target, now_ms)

	if (cached !== undefined) return cached

	const value = read()

	stamp_file.replace_stamp(target, { read_at_ms: now_ms, verdict: value })

	return value
}

const implementation_cut_verdict = {
	VERDICT_REUSE_MS,
	cache_path,
	reused_verdict,
}

export { implementation_cut_verdict }
