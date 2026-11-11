// **A CI completion wait reads its full snapshot only when the head's checks moved**
// (joshuafolkken/kit#7238). Each poll first asks the head's two commit listings — `check-runs` and
// `status` — with their ETags; a 304 from both is a poll where CI did not move, so the last snapshot
// answers it and the GraphQL session spends no query. A 304 still counts as a read, so the
// stable-read window advances on it exactly as on an unchanged full read.
//
// **The listings are asked by the branch, not by the last `head_sha`.** A push during the wait moves
// the branch; the old commit's listings would answer 304 for ever and keep a verdict on what is no
// longer the head. The combined status names its `sha`, so a moved head changes its ETag.
//
// **Answers the probe cannot vouch for, so the poll reads anyway:**
// - Anything once no check is pending. The probe only says CI has not moved; after CI settles the
//   merge state still moves on its own (a lagging `BLOCKED` turning `CLEAN`, a base move to
//   `DIRTY`), so only a snapshot that still waits on a running check is reused.
// - `mergeable_state` is computed late and moves without the pull request's ETag moving
//   (joshuafolkken/kit#4589, joshuafolkken/kit#6721), so a snapshot whose merge state is not yet
//   known is never reused.
// - A review decision the predicate wants this poll is not in the commit listings.
// - A probe that could not be read is taken as changed.
//
// The ETags a probe took are kept only once the full read after it succeeded, so a read that throws
// never leaves a 304 vouching for a snapshot that was not taken.
import { FULL_PAGE_QUERY, git_gh_api_path } from './git-gh-api-path'
import { git_gh_conditional, type ConditionalRead } from './git-gh-conditional'
import { CHECK_STATUS_PENDING, type PrStateSnapshot } from './git-pr-checks-parse'

// Whether this poll has to read the review listing, asked of the snapshot *without* one. It is a
// question about the current poll rather than a cache key: answering `false` skips one request now
// and nothing is carried into the next poll.
type ReviewDecisionPredicate = (snapshot: PrStateSnapshot) => boolean

type PrStateFetcher = (
	branch_name: string,
	should_read_review_decision: ReviewDecisionPredicate,
) => Promise<PrStateSnapshot>

type EtagsByPath = ReadonlyMap<string, string | undefined>

interface HeadProbe {
	is_unchanged: boolean
	etags: EtagsByPath
}

interface GateState {
	last: PrStateSnapshot | undefined
	etags: EtagsByPath
}

const MERGE_STATE_UNKNOWN = 'UNKNOWN'

function probe_paths(branch_name: string): Array<string> {
	const reference = encodeURIComponent(branch_name)

	return [
		`${git_gh_api_path.commit_check_runs_api_path(reference)}${FULL_PAGE_QUERY}`,
		git_gh_api_path.commit_status_api_path(reference),
	]
}

// A 304 keeps the ETag it was asked with; a listing that could not be read keeps none, so the next
// probe reads it whole.
function next_etag(read: ConditionalRead, previous: string | undefined): string | undefined {
	if (read.kind === 'unchanged') return previous

	return read.kind === 'changed' ? read.etag : undefined
}

async function probe_head(branch_name: string, etags: EtagsByPath): Promise<HeadProbe> {
	const reads = await Promise.all(
		probe_paths(branch_name).map(async (path) => ({
			path,
			read: await git_gh_conditional.read_conditional(path, etags.get(path)),
		})),
	)

	return {
		is_unchanged: reads.every(({ read }) => read.kind === 'unchanged'),
		etags: new Map(reads.map(({ path, read }) => [path, next_etag(read, etags.get(path))])),
	}
}

function is_merge_state_known(snapshot: PrStateSnapshot): boolean {
	const status = snapshot.merge_state_status

	return status !== undefined && status.toUpperCase() !== MERGE_STATE_UNKNOWN
}

function is_ci_running(snapshot: PrStateSnapshot): boolean {
	return snapshot.rollup.some((check) => check.status === CHECK_STATUS_PENDING)
}

function can_reuse(snapshot: PrStateSnapshot, should_read: ReviewDecisionPredicate): boolean {
	return is_ci_running(snapshot) && is_merge_state_known(snapshot) && !should_read(snapshot)
}

// The last snapshot where it can answer an unchanged poll, otherwise `undefined`.
function reusable(
	last: PrStateSnapshot | undefined,
	should_read: ReviewDecisionPredicate,
): PrStateSnapshot | undefined {
	return last !== undefined && can_reuse(last, should_read) ? last : undefined
}

// One gate per wait: the last snapshot and the ETags are that wait's, never shared between two.
function gate_fetcher(inner: PrStateFetcher): PrStateFetcher {
	const state: GateState = { last: undefined, etags: new Map() }

	return async function fetch_gated(
		branch_name: string,
		should_read_review_decision: ReviewDecisionPredicate,
	): Promise<PrStateSnapshot> {
		const probe = await probe_head(branch_name, state.etags)
		const reused = probe.is_unchanged
			? reusable(state.last, should_read_review_decision)
			: undefined
		if (reused !== undefined) return reused

		const snapshot = await inner(branch_name, should_read_review_decision)

		Object.assign(state, { last: snapshot, etags: probe.etags })

		return snapshot
	}
}

const git_pr_checks_gate = { gate_fetcher }

export { git_pr_checks_gate }
export type { PrStateFetcher, ReviewDecisionPredicate }
