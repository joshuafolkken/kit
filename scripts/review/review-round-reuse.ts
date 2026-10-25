import { issue_watch_gate } from '#scripts/issue/issue-watch-gate'
import { error_text } from '#scripts/lib/error-message'
import { review_record } from './review-record'
import { review_reviewed_tree } from './review-reviewed-tree'

// Whether `josh ship` reuses the recorded round 1 rather than reviewing it again — asked by the ship
// and by `josh review:record --check`, so a lane resuming on an old record reads the ship's own answer
// rather than mistaking "recorded" for "reused" (joshuafolkken/kit#4763).

// The issue changed after the recorded review was briefed — the refusal `josh followup` would make
// (joshuafolkken/kit#4221). A read that fails reads as fresh: `josh followup` still refuses a stale
// review at the merge.
async function is_stale_here(): Promise<boolean> {
	try {
		return (await issue_watch_gate.review_refusal_here()) !== undefined
	} catch (error) {
		error_text.trace_swallowed('review_round_reuse.is_stale_here', error)

		return false
	}
}

// What the ship does with the recorded round 1: `held` reuses it with nothing left to read; `delta`
// reuses it and leaves what moved since to round 2; `again` reviews round 1 again.
const REUSE = { AGAIN: 'again', DELTA: 'delta', HELD: 'held' } as const

type Reuse = (typeof REUSE)[keyof typeof REUSE]

const { MOVEMENT } = review_reviewed_tree

async function recorded_reuse(issue: number): Promise<Reuse> {
	const movement = await review_reviewed_tree.movement_here()

	if (movement === MOVEMENT.HELD) return REUSE.HELD

	const is_delta = movement === MOVEMENT.DELTA || review_reviewed_tree.is_stopped_on(issue)

	return is_delta ? REUSE.DELTA : REUSE.AGAIN
}

// **A recorded round 1 is reused while the tree it was recorded on holds still** — a lane's review
// before the ship (joshuafolkken/kit#4620) — **or once it moved only where round 2 reads**
// (joshuafolkken/kit#4878): round 2 reads that delta from the round-1 brief's stamp after the commit, so
// round 1 run again would read it twice. **The ship's own round 1 that stopped on a finding** is reused
// however the lane's fix moved the tree, for the same reason. Any other move — a High-cited file, a doc, a revert — is
// reviewed again, from that record (`review-reviewed-tree.ts`). An issue that changed after that round's brief is never
// reused: the recorded round never read it, and `josh followup` refuses the merge on it
// (joshuafolkken/kit#4221).
async function reuse(issue: number, is_stale: boolean): Promise<Reuse> {
	if (is_stale) return REUSE.AGAIN

	const recorded = await review_record.check(issue)

	return recorded.status === 'ok' ? await recorded_reuse(issue) : REUSE.AGAIN
}

async function is_reusable(issue: number, is_stale: boolean): Promise<boolean> {
	return (await reuse(issue, is_stale)) !== REUSE.AGAIN
}

// The ship's own answer for this checkout, asked before the ship runs; a git failure throws.
async function reuse_here(issue: number): Promise<Reuse> {
	return await reuse(issue, await is_stale_here())
}

async function is_reusable_here(issue: number): Promise<boolean> {
	return (await reuse_here(issue)) !== REUSE.AGAIN
}

const review_round_reuse = { REUSE, is_reusable, is_reusable_here, is_stale_here, reuse_here }

export type { Reuse }
export { review_round_reuse }
