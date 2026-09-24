import type { PrepParts } from './run-prep'
import { run_step, type PreVerdict } from './run-step'

// `josh run:next <N>` — the next step a `fullrun` takes, printed from the run's state
// (joshuafolkken/kit#2188). It is the foundation the epic #2166 rests on: the entry read is trimmed by
// replacing prose that a reader has to interpret with a command that answers "what now" from the same
// state `run:prep` already gathered, so the answer is computed rather than judged.
//
// **It is now the degenerate form of `run:step`** (joshuafolkken/kit#2248). `run:step` computes a run's
// position from the event stream, the carry record and the issue state; a `fullrun` with nothing emitted
// yet is at its pre-implementation position, which is exactly what this prints. The state → step mapping
// lives once, in `run-step.ts`'s `pre_verdict`, and this maps each verdict to the prose sentence a
// reader expects — so there is no second implementation of the mapping.

const ALREADY_DONE_STEP =
	'Issue is CLOSED — nothing to run. Verify it against merged code before starting.'
const KEEP_WORK_STEP =
	'Issue is CLOSED but this lane holds uncommitted work — stash it with `git stash push -u -m "<N>: uncommitted work at already-done"` before ending.'
const LATEST_STEP =
	'Update dependencies first (latest: required), load the dependency-update skill, then implement.'
const HUMAN_REVIEW_STEP =
	'Implement and run the verification gate, then STOP before the commit (needs-human-review).'
const IMPLEMENT_STEP = 'Implement, then run the verification gate (refactor, gate, /code-review).'
const UNKNOWN_STEP =
	'State could not be read — resolve the failure in run:prep before deciding the next step.'

// The prose sentence for each pre-implementation verdict `run:step` computes. The verdict set is
// `run-step.ts`'s, so a new position can never be printed here without a sentence to print it with.
const STEP_OF: Record<PreVerdict, string> = {
	'already-done': ALREADY_DONE_STEP,
	'human-review': HUMAN_REVIEW_STEP,
	implement: IMPLEMENT_STEP,
	'keep-work': KEEP_WORK_STEP,
	unknown: UNKNOWN_STEP,
	'update-deps': LATEST_STEP,
}

// The four facts a step is keyed on, lifted off `PrepParts` so the mapping is a pure function of state
// and the CLI does the reading. `state` is `undefined` exactly when `run:prep` could not read it.
interface NextInput {
	state: string | undefined
	is_human_review: boolean
	latest_scope: string
	has_changes: boolean
}

function to_input(parts: PrepParts): NextInput {
	return {
		state: parts.state?.state,
		is_human_review: parts.state?.is_human_review ?? false,
		latest_scope: parts.latest_scope,
		has_changes: parts.has_changes,
	}
}

// The prose for the pre-implementation position `run:step` computes — the degenerate case where the
// run has emitted no event yet. The ordering of the guards is `run-step.ts`'s `pre_verdict`, so the two
// never disagree about which fact wins.
function next_step(input: NextInput): string {
	return STEP_OF[run_step.pre_verdict(input)]
}

function format_report(parts: PrepParts): string {
	return next_step(to_input(parts))
}

const run_next = {
	ALREADY_DONE_STEP,
	HUMAN_REVIEW_STEP,
	IMPLEMENT_STEP,
	KEEP_WORK_STEP,
	LATEST_STEP,
	UNKNOWN_STEP,
	format_report,
	next_step,
	to_input,
}

export type { NextInput }
export { run_next }
