import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'

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

const WHOLE_CHANGE_TARGET =
	'Target: the whole change — `git diff main` plus the untracked files beside it.'

const ROUND_TWO_HEADING =
	'Round 2 — a verification pass over the fix delta, not a second full review.'

const ROUND_TWO_QUESTION =
	'Ask whether each first-round finding closed and whether the fix itself introduced a defect. Do not re-read the parts of the diff no fix touched.'

const NO_SNAPSHOT_LINE = `No round-1 snapshot was recorded, so the fix delta cannot be named. ${WHOLE_CHANGE_TARGET}`

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

// Green first: a matching gate stamp is a proven result, and a gate running beside it can only be a
// second one over the same unverified tree.
function gate_line(
	stamps: { gate: FileMapStamp | undefined; in_flight: FileMapStamp | undefined },
	tree: Record<string, string>,
): string {
	const green = matching_stamp(stamps.gate, tree)

	if (green !== undefined) return verified_line(green.taken_at)

	const running = live_marker(stamps.in_flight, tree)

	if (running !== undefined) return in_flight_line(running.taken_at)

	return NOT_VERIFIED_LINE
}

function format_paths(paths: ReadonlyArray<string>): string {
	return paths.map((relative) => `  ${relative}`).join('\n')
}

function round_two_target(delta: ReadonlyArray<string>): string {
	if (delta.length === 0) return EMPTY_DELTA_LINE

	return `Target: only these files, which are the ones round 1's fixes changed:\n${format_paths(delta)}`
}

// `undefined` for the snapshot and "the whole change" as the answer: a missing record must widen the
// review, never narrow it. A brief that silently reviewed nothing would be the cheapest possible run
// and the most dangerous.
function round_two_block(snapshot: FileMapStamp | undefined, tree: Record<string, string>): string {
	if (snapshot === undefined) return `${ROUND_TWO_HEADING}\n${NO_SNAPSHOT_LINE}`

	const delta = file_map_stamp.changed_since(snapshot, tree)
	// The snapshot's own timestamp, printed rather than assumed: a bare `review:brief` re-run between
	// the rounds retakes it against the post-fix tree, and the empty delta that follows would
	// otherwise read as "the fixes changed nothing" instead of "the record was retaken".
	const taken = `Round 1 was recorded at ${snapshot.taken_at}.`

	return `${ROUND_TWO_HEADING}\n${taken}\n${round_two_target(delta)}\n${ROUND_TWO_QUESTION}`
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
}

const SECOND_ROUND = 2

function target_block(input: BriefInput): string {
	if (input.round < SECOND_ROUND) return WHOLE_CHANGE_TARGET

	return round_two_block(input.stamps.round_one, input.tree)
}

// The level alone on the first line, because `review:level`'s contract — a caller reading the answer
// with `$(...)` — is the one thing a brief must not break.
function compose(input: BriefInput): string {
	return [
		input.level,
		'',
		gate_line(input.stamps, input.tree),
		TEST_COMMAND_LINE,
		'',
		target_block(input),
	].join('\n')
}

const review_brief = {
	compose,
	EMPTY_DELTA_LINE,
	gate_line,
	in_flight_line,
	live_marker,
	matching_stamp,
	NO_SNAPSHOT_LINE,
	NOT_VERIFIED_LINE,
	ROUND_TWO_HEADING,
	ROUND_TWO_QUESTION,
	round_two_block,
	SECOND_ROUND,
	TEST_COMMAND_LINE,
	WHOLE_CHANGE_TARGET,
}

export type { BriefInput, BriefStamps }
export { review_brief }
