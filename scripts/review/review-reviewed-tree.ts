import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { moved_paths, type MovedParts } from '#scripts/gate/moved-paths'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { review_attest } from './review-attest'
import { review_checkout, type ReviewCheckout } from './review-checkout'
import { review_round2 } from './review-round2'
import { review_stamps } from './review-stamps'

// The tree a recorded `/code-review` round stands for: the changed files as they were when
// `review:record` wrote the round, its fixes included (joshuafolkken/kit#4620). A lane reviews before
// `josh ship`, so the ship's round 1 asks this record whether the tree moved since: unmoved, the
// recorded round is the ship's; moved only where round 2 reads, it is still the ship's and round 2
// reads the delta (joshuafolkken/kit#4878); else round 1 reads the delta from here.
//
// **Taken at the record, not the brief**. A round that fixed findings approved its own edits, so the
// briefed tree is not what its verdict covers: a file reverted to the briefed bytes would drop out of a
// delta measured from there with its finding back in it.

const LINE_SUFFIX = /:\d+(?:-\d+)?$/u
// No file's digest: a path recorded with it never matches the tree, whether the change holds it or not.
const UNSETTLED_DIGEST = 'unsettled'

// **A file a recorded High cites is recorded as unsettled**: a High is never fixed in place, so the
// round's verdict does not stand for that file. Its digest matches no tree, so it always reads as moved
// — the tree is never held, and round 2 reads its fix where its delta holds it (joshuafolkken/kit#4941);
// anywhere else round 1 reads it again rather than passing over the finding it still holds. A file
// outside the change (a reader the change broke) is recorded too: left out, it would be absent on both
// sides and read as unmoved.
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
//
// **A `josh metrics` approval the branch rewrote is no move** (joshuafolkken/kit#4788): the ship's
// pre-detach re-record writes it after `review:record`, and it is data `josh metrics` derives and the
// gate's own metrics step checks, never what the round reviewed. An approval a recorded High cites
// stays unsettled, so it still reads as moved.
function is_rerecorded_approval(stamp: FileMapStamp, path: string): boolean {
	return release_approval_prune.is_approval(path) && stamp.files[path] !== UNSETTLED_DIGEST
}

// **A test added or edited since the record is no move** (joshuafolkken/kit#4874): `chain-rule.md`
// step 0 pins each `test:pinned` unpinned place after `review:record`, and a test changes no runtime
// the round's verdict covers; round 2 still reads the test delta (`review-round2.ts` keeps tests live).
// A test removed since, or one a recorded High cites, still reads as moved.
function is_pinning_test(stamp: FileMapStamp, tree: GateTree, path: string): boolean {
	const is_settled = Object.hasOwn(tree.files, path) && stamp.files[path] !== UNSETTLED_DIGEST

	return is_settled && test_declared_logic.is_test_file(path)
}

function is_no_move(stamp: FileMapStamp, tree: GateTree, path: string): boolean {
	return is_rerecorded_approval(stamp, path) || is_pinning_test(stamp, tree, path)
}

// How the tree stands against the record: `held` — nothing the round read moved; `delta` — every move
// is one round 2 reads (joshuafolkken/kit#4878); `unsettled` — any other move, or git did not answer.
const MOVEMENT = { DELTA: 'delta', HELD: 'held', UNSETTLED: 'unsettled' } as const

type Movement = (typeof MOVEMENT)[keyof typeof MOVEMENT]

// The movement, and on `unsettled` the condition that decided it, with the path that met it where one
// did — printed by `review:record --check` so a lane reads why the ship reviews round 1 again
// (joshuafolkken/kit#4941).
interface Standing {
	movement: Movement
	cause?: string
}

const CAUSE = {
	NO_RECORD: 'no reviewed tree was recorded',
	SKIPPED:
		'a move round 2 would not read — documentation, a prompt, an inert path, a revert to the briefed bytes, or a file outside the change',
	SYNCED: 'the default branch changed a file the round covers',
	UNFIXED:
		"a file a recorded High cites still holds its round-1 brief bytes, so no fix is in round 2's delta",
	UNATTESTED: 'the round was not attested on this branch',
	UNREAD: 'git did not answer',
} as const

function unsettled_by(cause: string, path?: string): Standing {
	return { movement: MOVEMENT.UNSETTLED, cause: path === undefined ? cause : `${cause}: ${path}` }
}

function moved_files(stamp: FileMapStamp, tree: GateTree, parts: MovedParts): Array<string> {
	return parts.changed.filter((path) => !is_no_move(stamp, tree, path))
}

// **Round 2 reads a move only where its own delta holds it**: it diffs from the round-1 brief's stamp
// (`briefed`) and passes over documentation, prompts and inert paths (`review-round2.ts`), so a file
// reverted to the briefed bytes, or one round 2 skips, would ship unread. A path a recorded High cites
// is read there too — its fix is the delta round 2 verifies, and its brief names the file as a High's
// fix (`review-brief.ts`). A default-branch change to a covered file is outside round 2's carried delta.
function is_read_by_round_two(
	path: string,
	tree: GateTree,
	briefed: FileMapStamp | undefined,
): boolean {
	if (review_round2.is_unexecuted(path, [])) return false

	return briefed?.files[path] !== tree.files[path]
}

// An unread High-cited file round 2 would execute is one whose fix has not landed, not a revert.
function unread_cause(stamp: FileMapStamp, path: string): string {
	const is_cited = stamp.files[path] === UNSETTLED_DIGEST

	return is_cited && !review_round2.is_unexecuted(path, []) ? CAUSE.UNFIXED : CAUSE.SKIPPED
}

function moved_standing(
	stamp: FileMapStamp,
	moved: ReadonlyArray<string>,
	tree: GateTree,
	briefed: FileMapStamp | undefined,
): Standing {
	if (moved.length === 0) return { movement: MOVEMENT.HELD }

	const unread = moved.find((path) => !is_read_by_round_two(path, tree, briefed))

	if (unread === undefined) return { movement: MOVEMENT.DELTA }

	return unsettled_by(unread_cause(stamp, unread), unread)
}

async function standing(
	stamp: FileMapStamp,
	tree: GateTree,
	briefed?: FileMapStamp,
): Promise<Standing> {
	const parts = await moved_paths.moved_parts(stamp, tree)

	if (parts === undefined) return unsettled_by(CAUSE.UNREAD)

	const synced = parts.synced.find((path) => Object.hasOwn(stamp.files, path))

	if (synced !== undefined) return unsettled_by(CAUSE.SYNCED, synced)

	return moved_standing(stamp, moved_files(stamp, tree, parts), tree, briefed)
}

async function movement(
	stamp: FileMapStamp,
	tree: GateTree,
	briefed?: FileMapStamp,
): Promise<Movement> {
	const answer = await standing(stamp, tree, briefed)

	return answer.movement
}

async function is_unmoved(stamp: FileMapStamp, tree: GateTree): Promise<boolean> {
	return (await movement(stamp, tree)) === MOVEMENT.HELD
}

// **Only a review attested on this branch is reused**, as `resume_point` narrows from no other: the
// reuse skips the ship's own `review:attest --check`, so a round recorded over a review that read
// another checkout, or never finished, would otherwise ship unreviewed.
async function standing_here(): Promise<Standing> {
	const stamp = review_stamps.reviewed_stamp.read()

	if (stamp === undefined) return unsettled_by(CAUSE.NO_RECORD)

	const checkout = await review_checkout.read_checkout()

	if (!review_attest.is_attested_on(checkout, checkout.root)) return unsettled_by(CAUSE.UNATTESTED)

	const tree = await gate_tree.read_gate_tree()

	return await standing(stamp, tree, review_stamps.round_one_stamp.read())
}

// The files a recorded High cites — the ones the round-2 brief names as a High's fix to read whole.
function high_cited(): ReadonlyArray<string> {
	const files = review_stamps.reviewed_stamp.read()?.files ?? {}

	return Object.keys(files).filter((path) => files[path] === UNSETTLED_DIGEST)
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
	MOVEMENT,
	discard,
	high_cited,
	is_stopped_on,
	is_unmoved,
	mark_stopped,
	movement,
	record,
	resume_point,
	standing_here,
}

export type { Movement, Standing }
export { review_reviewed_tree }
