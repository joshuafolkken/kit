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
// from the default branch, so everything the record says stays true while the branch it is measured
// against moves underneath it. Two shapes of that, one obvious and one not:
//
// - Straight after `git switch main && git pull` the map is **empty**, and an empty map compares
//   equal to any other empty map however many commits the pull brought in. `epicrun` runs exactly
//   that pair of commands between children.
// - Fetch an advanced default branch and rebase a feature branch onto it, and the map can come back
//   **byte-identical** — the same files still differ by the same digests — over a working tree whose
//   every other file has been replaced by code no check has read.
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
// and names the flag that runs the four anyway.
function format_skip(taken_at: string): string {
	return (
		`✔ this tree is already green — lint, the type check, the spell check and the unit tests ` +
		`all passed on it at ${taken_at} (\`pnpm josh gate\`).\n` +
		`  Reusing that result; nothing was re-run. \`pnpm josh gate ${FORCE_FLAG}\` runs the four checks anyway.`
	)
}

const gate_skip = { FORCE_FLAG, format_skip, reusable_green_gate }

export { gate_skip }
