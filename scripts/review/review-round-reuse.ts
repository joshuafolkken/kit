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

// The reuse, and on `again` why (joshuafolkken/kit#4941): `review:record --check` prints it, so a lane
// reads which condition re-runs round 1 rather than a list of every condition that could. On a reuse,
// `note` names the moves no round reads that it passed over (joshuafolkken/kit#5662).
interface ReuseAnswer {
	reuse: Reuse
	cause?: string | undefined
	note?: string | undefined
}

const STALE_CAUSE = "the issue changed after the recorded round's brief"
const UNRECORDED_CAUSE = 'no review round is recorded for this issue'

function reused_with(kind: Reuse, note: string | undefined): ReuseAnswer {
	return note === undefined ? { reuse: kind } : { reuse: kind, note }
}

async function recorded_answer(issue: number): Promise<ReuseAnswer> {
	const { movement, cause, note } = await review_reviewed_tree.standing_here()

	if (movement === MOVEMENT.HELD) return reused_with(REUSE.HELD, note)

	const is_delta = movement === MOVEMENT.DELTA || review_reviewed_tree.is_stopped_on(issue)

	return is_delta ? reused_with(REUSE.DELTA, note) : { reuse: REUSE.AGAIN, cause }
}

// **A recorded round 1 is reused while the tree it was recorded on holds still** — a lane's review
// before the ship (joshuafolkken/kit#4620) — **or once it moved only where round 2 reads**
// (joshuafolkken/kit#4878): round 2 reads that delta from the round-1 brief's stamp after the commit, so
// round 1 run again would read it twice. **The ship's own round 1 that stopped on a finding** is reused
// however the lane's fix moved the tree, for the same reason. A High-cited file's fix is such a move
// where round 2's delta holds it (joshuafolkken/kit#4941), and a doc, a prompt or an inert path no
// round executes is passed over (joshuafolkken/kit#5662). Any other move — a revert — is reviewed
// again, from that record (`review-reviewed-tree.ts`). An issue that changed after that
// round's brief is never reused: the recorded round never read it, and `josh followup` refuses the merge on it
// (joshuafolkken/kit#4221).
async function answer(issue: number, is_stale: boolean): Promise<ReuseAnswer> {
	if (is_stale) return { reuse: REUSE.AGAIN, cause: STALE_CAUSE }

	const recorded = await review_record.check(issue)

	if (recorded.status !== 'ok') return { reuse: REUSE.AGAIN, cause: UNRECORDED_CAUSE }

	return await recorded_answer(issue)
}

async function reuse(issue: number, is_stale: boolean): Promise<Reuse> {
	const reused = await answer(issue, is_stale)

	return reused.reuse
}

async function is_reusable(issue: number, is_stale: boolean): Promise<boolean> {
	return (await reuse(issue, is_stale)) !== REUSE.AGAIN
}

// The ship's own answer for this checkout, asked before the ship runs; a git failure throws.
async function answer_here(issue: number): Promise<ReuseAnswer> {
	return await answer(issue, await is_stale_here())
}

async function reuse_here(issue: number): Promise<Reuse> {
	const reused = await answer_here(issue)

	return reused.reuse
}

async function is_reusable_here(issue: number): Promise<boolean> {
	return (await reuse_here(issue)) !== REUSE.AGAIN
}

const review_round_reuse = {
	REUSE,
	answer,
	answer_here,
	is_reusable,
	is_reusable_here,
	is_stale_here,
	reuse_here,
}

export type { Reuse, ReuseAnswer }
export { review_round_reuse }
