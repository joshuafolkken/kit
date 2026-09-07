import type { FileMapStamp } from './josh/file-map-stamp'
import { review_brief } from './review/review-brief'
import { review_stamps } from './review/review-stamps'

// Whether `josh gate` already has the answer it is about to spend 47–50 seconds computing again
// (joshuafolkken/kit#1328).
//
// The record has existed since joshuafolkken/kit#1241: `record_green_gate` writes the digest of every
// changed file the four checks were green on, and `josh review:brief` reads it back to print
// `Already verified`. The gate itself never read it, so a second run over an unedited tree started
// four processes to reach a conclusion already on disk. **This is reuse of a result, not a check
// dropped**: the bytes the skip answers for are the bytes the record was written from, compared one
// by one.
//
// **The tree comparison is `review_brief.matching_stamp`, not a second copy of it.** "There is a
// record and nothing it covers has moved" is one question with one answer, and a gate that decided it
// differently from the brief printed beside it would be two commands disagreeing about the same tree.
//
// **A file map does not describe a tree on its own, because it is a diff.** It lists what differs
// from the commit the branch was cut from — its merge base with the default branch since
// joshuafolkken/kit#1527 — so everything the record says stays true while that base moves underneath
// it. Two shapes of that, one obvious and one not:
//
// - Straight after `git switch main && git pull` the map is **empty**, and an empty map compares
//   equal to any other empty map however many commits the pull brought in. `epicrun` runs exactly
//   that pair of commands between children.
// - Fetch an advanced default branch and rebase a feature branch onto it, and the map can come back
//   **byte-identical** — the same files still differ by the same digests — over a working tree whose
//   every other file has been replaced by code no check has read. The rebase moves `HEAD`, so it
//   moves the merge base with it, and the base check still catches this.
//
// **What no longer refuses a reuse is another lane merging into the shared default branch**
// (joshuafolkken/kit#1527). In a linked work tree the default branch's ref is shared, but the merge
// base is a commit: an advance this branch is an ancestor of does not move it, and nothing this
// checkout's four checks read has changed — so refusing there would have discarded a record that
// still describes the tree exactly.
//
// So the record pins the commit the map was taken against, and both halves have to match. The empty
// map is refused on top of that rather than left to the base check, because a skip there buys nothing
// worth the argument: a tree with no changed file is not where a run spends its gate time.
//
// Two refusals need no code here. A gate that went red writes no record at all, so the re-verification
// after a fix finds nothing to reuse; and joshuafolkken/kit#1261's join before the commit follows a
// `josh bump`, which edits `package.json` into the map.
//
// **What is reused is a silent green run.** `record_green_gate` withholds the record from a run that
// printed anything — a skip notice, or a check that passed with warnings — because the skip prints no
// check bodies at all, and a record taken from such a run would make those lines disappear from every
// later run over the same tree.

// The escape hatch, for the times a person knows something outside the tree moved — a `pnpm install`,
// a toolchain change, a cache thrown away. It lives beside the decision it overrides rather than with
// the gate's other flag, so removing the skip would take its flag with it.
const FORCE_FLAG = '--force'

// The stamp rather than a boolean, for the same reason `review_brief.matching_stamp` hands one back:
// the caller prints `taken_at`, and a record that does not describe this tree has no timestamp worth
// printing. The source is a parameter so a test can plant a record without overwriting the one a real
// run relies on — `josh gate` and `josh review:brief` share one path by design.
//
// A `base` that could not be read is `undefined`, and an older record carries none: both compare
// unequal to anything, so the gate runs its checks. No base means no reuse, never reuse without one.
function reusable_green_gate(
	tree: Record<string, string>,
	base: string | undefined,
	source?: string,
): FileMapStamp | undefined {
	if (base === undefined || Object.keys(tree).length === 0) return undefined

	const stamp = review_brief.matching_stamp(review_stamps.gate_stamp.read(source), tree)

	if (stamp?.base !== base) return undefined

	return stamp
}

// **The sentence claims the result, and never merely the omission.** "verification skipped" on its
// own reads as `Not verified` — the one thing this output must not be mistaken for, since the run
// goes on to a commit on the strength of it. So the line says what passed, on which tree and when,
// and names the flag or the variable that runs the checks anyway.
//
// **One sentence, every reader of the record** (joshuafolkken/kit#1381). The gate says it, the
// pre-push hook says it and the pre-commit hook says it, and three copies of a claim this load-bearing
// would not have stayed the same sentence — the clone `CLAUDE.md` prohibits. What differs between them
// is four fragments and nothing else, so those are the parameters and the shape is not.
interface ReuseNotice {
	// The noun phrase that `passed on it` is said of — `the unit tests`, `the type check`.
	subject: string
	// What the git operation about to happen carries, where the reader has a narrower condition than
	// the gate's own. Empty for the gate, which speaks about the working tree it just read.
	carried_clause: string
	taken_at: string
	// How a person runs the checks anyway: a flag where they type the command, a variable where the
	// command line belongs to `lefthook/base.yml`.
	force_hint: string
	// What that hint re-runs, so the last clause reads as English in each caller — `the four checks`,
	// `them`, `it`.
	rerun_object: string
}

function format_reuse_notice(notice: ReuseNotice): string {
	return (
		`✔ this tree is already green — ${notice.subject} passed on it at ${notice.taken_at} ` +
		`(\`pnpm josh gate\`)${notice.carried_clause}.\n` +
		`  Reusing that result; nothing was re-run. \`${notice.force_hint}\` runs ${notice.rerun_object} anyway.`
	)
}

function format_skip(taken_at: string): string {
	return format_reuse_notice({
		subject: 'lint, the type check, the spell check and the unit tests all',
		carried_clause: '',
		taken_at,
		force_hint: `pnpm josh gate ${FORCE_FLAG}`,
		rerun_object: 'the four checks',
	})
}

const gate_skip = { FORCE_FLAG, format_reuse_notice, format_skip, reusable_green_gate }

export type { ReuseNotice }

export { gate_skip }
