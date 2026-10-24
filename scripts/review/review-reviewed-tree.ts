import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { moved_paths } from '#scripts/gate/moved-paths'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { review_attest } from './review-attest'
import { review_checkout, type ReviewCheckout } from './review-checkout'
import { review_stamps } from './review-stamps'

// The tree a recorded `/code-review` round stands for: the changed files as they were when
// `review:record` wrote the round, its fixes included (joshuafolkken/kit#4620). A lane reviews before
// `josh ship`, so the ship's round 1 asks this record whether the tree moved since: unmoved, the
// recorded round is the ship's; moved, the round reads the delta from here.
//
// **Taken at the record, not the brief**. A round that fixed findings approved its own edits, so the
// briefed tree is not what its verdict covers: a file reverted to the briefed bytes would drop out of a
// delta measured from there with its finding back in it.

const LINE_SUFFIX = /:\d+(?:-\d+)?$/u
// No file's digest: a path recorded with it never matches the tree, whether the change holds it or not.
const UNSETTLED_DIGEST = 'unsettled'

// **A file a recorded High cites is recorded as unsettled**: a High is never fixed in place, so the
// round's verdict does not stand for that file. Its digest matches no tree, so it always reads as moved
// — the tree is never reused, and a narrowed round reads it again rather than passing over the finding
// it still holds. A file outside the change (a reader the change broke) is recorded too: left out, it
// would be absent on both sides and read as unmoved.
function settled_files(
	files: Record<string, string>,
	unsettled: ReadonlyArray<string>,
): Record<string, string> {
	const cited = unsettled.map((file): [string, string] => [
		file.replace(LINE_SUFFIX, ''),
		UNSETTLED_DIGEST,
	])

	return { ...files, ...Object.fromEntries(cited) }
}

// Swallowed: no record re-runs the ship's round 1 over the whole change — wider, never narrower.
async function record(unsettled: ReadonlyArray<string> = []): Promise<void> {
	try {
		const { files, base } = await gate_tree.read_gate_tree()

		review_stamps.reviewed_stamp.write(settled_files(files, unsettled), undefined, base)
	} catch {
		/* no record widens the next round rather than narrowing it */
	}
}

// An empty tree or an unresolved base is git not answering, never "nothing moved".
//
// **A base the ship's sync moved is unmoved for every path the default branch left alone**
// (joshuafolkken/kit#4829): with every recorded digest matching, only a synced path the round covers
// changes what it read. Main's other paths are the scoped pair's, the gate's and CI's to check.
async function is_unmoved(stamp: FileMapStamp, tree: GateTree): Promise<boolean> {
	const parts = await moved_paths.moved_parts(stamp, tree)

	if (parts === undefined || parts.changed.length > 0) return false

	return parts.synced.every((path) => !Object.hasOwn(stamp.files, path))
}

// **Only a review attested on this branch is reused**, as `resume_point` narrows from no other: the
// reuse skips the ship's own `review:attest --check`, so a round recorded over a review that read
// another checkout, or never finished, would otherwise ship unreviewed.
async function is_unmoved_here(): Promise<boolean> {
	const stamp = review_stamps.reviewed_stamp.read()

	if (stamp === undefined) return false

	const checkout = await review_checkout.read_checkout()

	if (!review_attest.is_attested_on(checkout, checkout.root)) return false

	return await is_unmoved(stamp, await gate_tree.read_gate_tree())
}

// The record a resumed brief narrows from: written after the brief the pointer names, whose review was
// attested on this branch. Asked before the next brief mints its pointer, which this record then
// predates — so it narrows one round, never two.
function resume_point(checkout: ReviewCheckout): FileMapStamp | undefined {
	const stamp = review_stamps.reviewed_stamp.read()

	if (stamp === undefined || !review_attest.is_briefed_since(stamp.taken_at, checkout.root)) {
		return undefined
	}

	return review_attest.is_attested_on(checkout, checkout.root) ? stamp : undefined
}

// **A ship's round 1 that stopped on a finding stays its round 1 however the tree moves since**: the
// tree moves by the fix, and the fix delta is round 2's to verify (joshuafolkken/kit#2964). Reviewed
// as round 1 again, every stop would cost one more review and one more chance to stop. The marker
// names the issue, so a checkout that ships another issue next never reuses this one's round.
const STOPPED_PREFIX = 'josh-review-round1-stopped-'

function stopped_path(): string {
	return stamp_file.stamp_path(STOPPED_PREFIX, PROJECT_ROOT)
}

// Written when the ship's round 1 stops on a finding, removed when it ends any other way. A write the
// temp directory refuses is swallowed: no marker re-runs round 1 — wider, never narrower.
function mark_stopped(issue: number, is_stopped: boolean): void {
	if (!is_stopped) {
		stamp_file.remove_stamp(stopped_path())

		return
	}

	try {
		stamp_file.write_text_stamp(stopped_path(), String(issue))
	} catch {
		/* no marker reviews round 1 again rather than passing over it */
	}
}

function is_stopped_on(issue: number): boolean {
	return stamp_file.read_stamp_text(stopped_path()) === String(issue)
}

// The ship drops both records when the issue changed after the recorded round's brief: that round never
// read the new specification, so the next one reviews the whole change.
function discard(): void {
	try {
		review_stamps.reviewed_stamp.remove()
		stamp_file.remove_stamp(stopped_path())
	} catch {
		/* the temp directory refused the removal; nothing else here can */
	}
}

const review_reviewed_tree = {
	discard,
	is_stopped_on,
	is_unmoved,
	is_unmoved_here,
	mark_stopped,
	record,
	resume_point,
}

export { review_reviewed_tree }
