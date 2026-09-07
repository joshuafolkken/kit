import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_checkout, type ReviewCheckout } from './review-checkout'

// The text `josh review:brief` prints — the `/code-review` invocation, composed from what the run
// already knows (joshuafolkken/kit#1241).
//
// **Why a command and not a paragraph in `prompts/review.md`.** `/code-review` runs in a forked
// process and reads none of this repository's documents; the only thing that reaches it is the
// argument it is invoked with. Measured on joshuafolkken/kit#1240: both rounds re-ran the unit suite
// `josh gate` had just passed, both fumbled the runner (`npx vitest`, then a retry), and round 2
// re-read the whole diff — 439 seconds for a seven-file change. joshuafolkken/kit#1219 had already
// redefined round 2 as a verification pass **in a document the agent never opens**, which is why it
// cut nothing.
//
// **What is mechanical and what is only an instruction.** The round-2 target is mechanical: the
// paths are computed from a digest comparison and handed over as the scope. The "already verified"
// block is an instruction — the agent has a shell and can run whatever it likes — so the effect of
// that half is measured, never assumed.

const TEST_COMMAND_LINE =
	'- The unit suite is `pnpm josh test:unit`. Do not reach for `npx vitest`; it is not how this project runs them.'

// **The checkout block, and why the target below names a path instead of assuming one**
// (joshuafolkken/kit#1522). `/code-review` is forked by the harness and inherits the session's
// working directory, so during a lane run it starts in a tree that holds the previous child's
// already-merged code. Reading that tree, it finds nothing wrong and says so — and the run reads
// that silence as a clean review. Neither half of this block is a paragraph a person has to remember
// to type: the path is generated from `git rev-parse --show-toplevel` in the checkout the run is
// implementing in, and the nonce is written to a record before it is printed.
// **The root is interpolated rather than left as a placeholder.** Every other path this brief prints
// is absolute for one reason — a forked agent resolves a relative path against its own tree — and a
// literal `<path>` in the line that says *how* to run the commands undoes exactly that: copied
// verbatim it fails, and the agent falls back to the checkout it inherited, which is the wrong one.
function checkout_warning(root: string): string {
	return `You do not inherit that working directory. Run every command for this review against it — \`git -C ${root} …\` — and read no file outside it.`
}

function attest_line(nonce: string): string {
	return `Attest before you report: run \`pnpm josh review:attest ${nonce}\` from the checkout you actually read. A non-zero exit means it was not the one above — report \`REVIEW TARGET MISMATCH\` and no findings. Never report "no findings" without that command having passed: a review of the wrong tree finds nothing wrong, and the run cannot tell that apart from approval (joshuafolkken/kit#1522).`
}

function checkout_block(checkout: ReviewCheckout, nonce: string): string {
	return [
		`Checkout: ${review_checkout.describe_checkout(checkout)}`,
		checkout_warning(checkout.root),
		attest_line(nonce),
	].join('\n')
}

// `-C <root>` rather than a bare `git diff`, so the command works from whatever directory the
// forked agent happens to be sitting in rather than only from the right one.
//
// **The base is the merge base, not `main` itself** (joshuafolkken/kit#1527). A linked work tree
// shares the `main` ref with every other lane, so a two-dot `git diff main` run in an unmerged lane
// lists whatever another lane merged in the meantime — in reverse. This line is a command the forked
// agent runs, so printing the old spelling would hand it exactly the mixed-in listing the reading
// itself no longer produces.
//
// **The base is resolved here and embedded as a value, never printed as a `$(…)` substitution.** A
// subshell that fails expands to the empty string, and `git -C <root> diff` with no revision exits 0
// listing only the *unstaged* working tree — so a `merge-base` that could not answer would silently
// narrow the review to a fraction of the change and the agent would report "no findings" on code it
// never read. `git_command.change_base` already degrades to the default branch name instead, which
// is the previous command and fails loudly rather than open.
function whole_change_target(root: string, base: string): string {
	const command = `git -C ${root} diff ${base}`

	return `Target: the whole change — \`${command}\` plus the untracked files beside it.`
}

const ROUND_TWO_HEADING =
	'Round 2 — a verification pass over the fix delta, not a second full review.'

const ROUND_TWO_QUESTION =
	'Ask whether each first-round finding closed and whether the fix itself introduced a defect. Do not re-read the parts of the diff no fix touched.'

function no_snapshot_line(root: string, base: string): string {
	return `No round-1 snapshot was recorded, so the fix delta cannot be named. ${whole_change_target(root, base)}`
}

const EMPTY_DELTA_LINE =
	'The fix delta is empty — nothing changed since round 1, so there is nothing for a verification pass to read.'

const NOT_VERIFIED_LINE =
	'Not verified: `pnpm josh gate` has not passed on this exact tree. Nothing here claims lint, the type check, the spell check or the unit tests are green.'

// Named so the caller and the test agree on the sentence without either restating it: a brief that
// says the gate passed when it did not is the one failure this whole record exists to prevent.
//
// The stamp comes back rather than a boolean so the caller reaches `taken_at` on a value it has
// already narrowed — a record that does not describe this tree has no timestamp worth printing, and
// the two answers should not be reachable through the same variable.
function matching_stamp(
	stamp: FileMapStamp | undefined,
	tree: Record<string, string>,
): FileMapStamp | undefined {
	if (stamp === undefined || file_map_stamp.changed_since(stamp, tree).length > 0) return undefined

	return stamp
}

function verified_line(taken_at: string): string {
	return `Already verified — do not re-run these:\n- lint, the type check, the spell check and the unit tests all passed on this exact tree at ${taken_at} (\`pnpm josh gate\`).`
}

// **The in-flight sentence claims no result, and that is the point** (joshuafolkken/kit#1242). The
// gate and this review are started together, so the honest thing to say is that a gate is running —
// not that it passed. What it forbids is re-running the unit suite, which is wasted whether the gate
// ends green or red, and it names who joins the result so the reader knows the check is not being
// skipped.
function in_flight_line(taken_at: string): string {
	return `Running now — do not re-run these:\n- \`pnpm josh gate\` started against this exact tree at ${taken_at} and has not recorded a result. Lint, the type check, the spell check and the unit tests are being run beside this review; the run joins that result before it commits, and it is that result — never one you produce here — that gates the merge. Nothing here claims any of them are green.`
}

// **The marker asserts a live process, so matching the tree is not enough.** `josh gate` clears it in
// a `finally`, and a `finally` does not run when the gate is killed — Ctrl-C, Stop, SIGTERM — so an
// interrupted gate leaves the file on disk with the tree it was reading still intact. Believed on the
// digests alone it would say a gate is running for as long as nobody edits that tree, about a process
// that no longer exists: exactly the state the record must never describe. The written `pid` is what
// separates the two, and a marker with none is read as not running, which falls back to `Not verified`.
function live_marker(
	stamp: FileMapStamp | undefined,
	tree: Record<string, string>,
): FileMapStamp | undefined {
	const matched = matching_stamp(stamp, tree)

	if (matched === undefined || !file_map_stamp.is_process_alive(matched.pid)) return undefined

	return matched
}

// **Matching digests are not enough for the green claim** (joshuafolkken/kit#1537). The map covers
// the paths the change makes changed, so a merge of the default branch that touches nothing the
// branch touches leaves every digest identical while the tree gains code the gate never read —
// and the brief would tell the reviewer that lint, the type check, the spell check and the unit tests
// passed on "this exact tree". The gate already records the commit it measured against, and
// `gate-skip.ts` already refuses reuse on it; this is the same refusal for the same record.
//
// **The in-flight marker is deliberately left alone.** It carries no base, and it claims no result:
// the worst a moved base does there is report that a gate is running, which is true.
function green_stamp(
	stamp: FileMapStamp | undefined,
	tree: Record<string, string>,
	base: string,
): FileMapStamp | undefined {
	const matched = matching_stamp(stamp, tree)

	if (matched === undefined || !file_map_stamp.describes_base(matched, base)) return undefined

	return matched
}

// Green first: a matching gate stamp is a proven result, and a gate running beside it can only be a
// second one over the same unverified tree.
function gate_line(
	stamps: { gate: FileMapStamp | undefined; in_flight: FileMapStamp | undefined },
	tree: Record<string, string>,
	base: string,
): string {
	const green = green_stamp(stamps.gate, tree, base)

	if (green !== undefined) return verified_line(green.taken_at)

	const running = live_marker(stamps.in_flight, tree)

	if (running !== undefined) return in_flight_line(running.taken_at)

	return NOT_VERIFIED_LINE
}

// Absolute, for the same reason the round-1 target carries `-C`: git prints repository-root-relative
// paths, and a forked agent sitting in another checkout resolves them against that one — where the
// same relative path names a different file, or none.
function format_paths(root: string, paths: ReadonlyArray<string>): string {
	return paths.map((relative) => `  ${root}/${relative}`).join('\n')
}

function round_two_target(root: string, delta: ReadonlyArray<string>): string {
	if (delta.length === 0) return EMPTY_DELTA_LINE

	return `Target: only these files, which are the ones round 1's fixes changed:\n${format_paths(root, delta)}`
}

// **What round 2 is sent to read, reconciled against the change it is meant to cover**
// (joshuafolkken/kit#1537). The delta alone is not that list. It is the difference between two file
// maps, each one a diff against `change_base` **as it stood when that map was taken** — and nothing
// used to record which commit that was. Move the base between the rounds, which is exactly what a
// resumed run's merge of the default branch does, and the two maps stop covering the same set of
// paths: their difference then names files the branch never touched and misses files it did.
//
// The three fields are the whole reconciliation, and the run needs all three rather than the first:
// `target` is what to read, `dropped` is what the comparison offered that this change does not
// contain, and `carried` counts what this change contains that round 1 already read. A brief that
// printed `target` alone would still be silently disagreeing with `git diff` — the failure the Issue
// was filed on — it would just be disagreeing in a smaller way.
//
// **`recorded_at` is present exactly when the round is narrow.** It is the timestamp of the record the
// delta was measured from, and its absence is what says the round was widened — so the block below
// branches on this one decision rather than making a second one of its own.
interface RoundTwoScope {
	recorded_at: string | undefined
	target: ReadonlyArray<string>
	dropped: ReadonlyArray<string>
	carried: ReadonlyArray<string>
}

function sorted_names(names: ReadonlyArray<string>): ReadonlyArray<string> {
	return [...names].toSorted((left, right) => left.localeCompare(right))
}

// A record that cannot be compared widens the round to the whole change rather than narrowing it, so
// every path the change touches is a target. This is the same direction joshuafolkken/kit#1241 chose
// for a missing record, extended to a record that is present and unusable.
function whole_change_scope(tree: Record<string, string>): RoundTwoScope {
	return {
		recorded_at: undefined,
		target: sorted_names(Object.keys(tree)),
		dropped: [],
		carried: [],
	}
}

// `tree`'s keys are this change's paths — `git diff <base>` plus the untracked files beside it — so
// intersecting against them is what keeps a path the change does not contain out of the target.
function delta_scope(
	delta: ReadonlyArray<string>,
	tree: Record<string, string>,
	recorded_at: string,
): RoundTwoScope {
	const target = delta.filter((name) => Object.hasOwn(tree, name))

	return {
		recorded_at,
		target,
		dropped: delta.filter((name) => !Object.hasOwn(tree, name)),
		carried: sorted_names(Object.keys(tree).filter((name) => !target.includes(name))),
	}
}

// A type predicate rather than two spellings of the same condition: the scope and the printed block
// must never disagree about whether the record was usable.
function is_comparable(snapshot: FileMapStamp | undefined, base: string): snapshot is FileMapStamp {
	return snapshot !== undefined && file_map_stamp.describes_base(snapshot, base)
}

function round_two_scope(
	snapshot: FileMapStamp | undefined,
	tree: Record<string, string>,
	base: string,
): RoundTwoScope {
	if (!is_comparable(snapshot, base)) return whole_change_scope(tree)

	return delta_scope(file_map_stamp.changed_since(snapshot, tree), tree, snapshot.taken_at)
}

const BASE_MOVED_PREFIX = 'The change base moved since round 1 was recorded'

function base_moved_line(snapshot: FileMapStamp, root: string, base: string): string {
	const recorded = snapshot.base ?? 'a commit it did not record'

	return `${BASE_MOVED_PREFIX} — round 1 measured this change against ${recorded}, this round measures it against ${base}. The two file maps therefore cover different sets of files, and their difference is not the fix delta. ${whole_change_target(root, base)}`
}

function widened_line(snapshot: FileMapStamp | undefined, root: string, base: string): string {
	if (snapshot === undefined) return no_snapshot_line(root, base)

	return base_moved_line(snapshot, root, base)
}

function dropped_line(root: string, dropped: ReadonlyArray<string>): string {
	return `Not in this change, so not a target here — the comparison offered them and \`git diff\` does not list them:\n${format_paths(root, dropped)}`
}

function carried_line(root: string, base: string, count: number): string {
	return `${String(count)} further file(s) this change touches are byte-identical to round 1 and were read there, so they are deliberately out of scope. Reconcile before you report: \`git -C ${root} diff --name-only ${base}\` plus the untracked files beside it is this change, and every path in it is either a target above or one of those.`
}

function reconciliation(root: string, base: string, scope: RoundTwoScope): ReadonlyArray<string> {
	return [
		...(scope.dropped.length > 0 ? [dropped_line(root, scope.dropped)] : []),
		...(scope.carried.length > 0 ? [carried_line(root, base, scope.carried.length)] : []),
	]
}

// The snapshot's own timestamp, printed rather than assumed. Since joshuafolkken/kit#1441 the record
// is round 1's own — written once per run, and kept by a later round-1 invocation rather than retaken
// against the fixed tree — so this line says how far back the target below is measured from. A record
// left behind by a run that never reached `josh followup` makes the target wider, and its timestamp is
// the only thing that shows that from here.
function narrow_block(
	recorded_at: string,
	scope: RoundTwoScope,
	root: string,
	base: string,
): string {
	return [
		ROUND_TWO_HEADING,
		`Round 1 was recorded at ${recorded_at}.`,
		round_two_target(root, scope.target),
		...reconciliation(root, base, scope),
		ROUND_TWO_QUESTION,
	].join('\n')
}

// `undefined` for the snapshot and "the whole change" as the answer: a missing record must widen the
// review, never narrow it. A brief that silently reviewed nothing would be the cheapest possible run
// and the most dangerous.
function round_two_block(
	snapshot: FileMapStamp | undefined,
	tree: Record<string, string>,
	root: string,
	base: string,
): string {
	const scope = round_two_scope(snapshot, tree, base)

	if (scope.recorded_at === undefined) {
		return `${ROUND_TWO_HEADING}\n${widened_line(snapshot, root, base)}`
	}

	return narrow_block(scope.recorded_at, scope, root, base)
}

interface BriefStamps {
	gate: FileMapStamp | undefined
	in_flight: FileMapStamp | undefined
	round_one: FileMapStamp | undefined
}

interface BriefInput {
	level: string
	round: number
	tree: Record<string, string>
	stamps: BriefStamps
	checkout: ReviewCheckout
	nonce: string
	// The commit the change is measured against, resolved by the caller so the printed target carries
	// a value rather than a subshell that can fail open (joshuafolkken/kit#1527).
	base: string
}

const SECOND_ROUND = 2

function target_block(input: BriefInput): string {
	if (input.round < SECOND_ROUND) return whole_change_target(input.checkout.root, input.base)

	return round_two_block(input.stamps.round_one, input.tree, input.checkout.root, input.base)
}

// The level alone on the first line, because `review:level`'s contract — a caller reading the answer
// with `$(...)` — is the one thing a brief must not break.
function compose(input: BriefInput): string {
	return [
		input.level,
		'',
		checkout_block(input.checkout, input.nonce),
		'',
		gate_line(input.stamps, input.tree, input.base),
		TEST_COMMAND_LINE,
		'',
		target_block(input),
	].join('\n')
}

const review_brief = {
	attest_line,
	BASE_MOVED_PREFIX,
	base_moved_line,
	carried_line,
	checkout_block,
	checkout_warning,
	compose,
	dropped_line,
	EMPTY_DELTA_LINE,
	gate_line,
	green_stamp,
	in_flight_line,
	live_marker,
	matching_stamp,
	no_snapshot_line,
	NOT_VERIFIED_LINE,
	ROUND_TWO_HEADING,
	ROUND_TWO_QUESTION,
	round_two_block,
	round_two_scope,
	SECOND_ROUND,
	TEST_COMMAND_LINE,
	whole_change_target,
}

export type { BriefInput, BriefStamps, RoundTwoScope }
export { review_brief }
