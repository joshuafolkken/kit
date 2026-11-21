import { lane_ledger, type LedgerEntry } from '#scripts/lane/lane-ledger'
import { lane_ledger_kind } from '#scripts/lane/lane-ledger-kind'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { lane_resolve } from '#scripts/lane/lane-resolve'
import { review_prompt_level, type RetryTrigger } from './review-prompt-level'

// Whether a round-1 review runs after a lane conflict resolution (joshuafolkken/kit#8494). The mark is
// read off existing records, no state file of its own: the Issue's trusted `## Lane conflict resolved`
// comments against the ledger's last round-one record (ran or reused) for the Issue. A resolution
// after that record — or any resolution when no round 1 was recorded — is post-conflict. A read that
// fails answers no, so the review still runs and only the trigger word falls back.

const { POST_CONFLICT, STALE } = review_prompt_level.RETRY

function last_round_one(entries: ReadonlyArray<LedgerEntry>, issue: number): number {
	const times = entries
		.filter((entry) => entry.kind === lane_ledger_kind.KIND.ROUND_ONE && entry.issue === issue)
		.map((entry) => Date.parse(entry.at))

	return Math.max(-Infinity, ...times)
}

async function ledger_entries(): Promise<ReadonlyArray<LedgerEntry>> {
	const path = await lane_ledger_write.target()

	return path === undefined ? [] : lane_ledger.read_entries(path)
}

async function is_post_conflict(issue: number): Promise<boolean> {
	try {
		const resolved = await lane_resolve.resolutions(String(issue))
		const since = last_round_one(await ledger_entries(), issue)

		return resolved?.some((comment) => Date.parse(comment.created_at) > since) === true
	} catch {
		return false
	}
}

// The trigger a round-1 rerun names before the checkpoint's own: post-conflict over stale-retry, the
// more specific cause; `undefined` leaves the checkpoint's retry, if any.
async function trigger(issue: number, is_stale: boolean): Promise<RetryTrigger | undefined> {
	if (await is_post_conflict(issue)) return POST_CONFLICT

	return is_stale ? STALE : undefined
}

const review_post_conflict = { is_post_conflict, trigger }

export { review_post_conflict }
