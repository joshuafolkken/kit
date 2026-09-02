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

// Named so the caller and the test agree on the sentence without either restating it: a brief that
// says the gate passed when it did not is the one failure this whole record exists to prevent.
function gate_line(stamp: FileMapStamp | undefined, tree: Record<string, string>): string {
	if (stamp === undefined || file_map_stamp.changed_since(stamp, tree).length > 0) {
		return 'Not verified: `pnpm josh gate` has not passed on this exact tree. Nothing here claims lint, the type check, the spell check or the unit tests are green.'
	}

	return `Already verified — do not re-run these:\n- lint, the type check, the spell check and the unit tests all passed on this exact tree at ${stamp.taken_at} (\`pnpm josh gate\`).`
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

interface BriefInput {
	level: string
	round: number
	tree: Record<string, string>
	stamps: { gate: FileMapStamp | undefined; round_one: FileMapStamp | undefined }
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
		gate_line(input.stamps.gate, input.tree),
		TEST_COMMAND_LINE,
		'',
		target_block(input),
	].join('\n')
}

const review_brief = {
	compose,
	EMPTY_DELTA_LINE,
	gate_line,
	NO_SNAPSHOT_LINE,
	ROUND_TWO_HEADING,
	ROUND_TWO_QUESTION,
	round_two_block,
	SECOND_ROUND,
	TEST_COMMAND_LINE,
	WHOLE_CHANGE_TARGET,
}

export type { BriefInput }
export { review_brief }
