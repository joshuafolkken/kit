import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import type { PrepParts } from './run-prep'

// `josh run:next <N>` — the next step a `fullrun` takes, printed from the run's state
// (joshuafolkken/kit#2188). It is the foundation the epic #2166 rests on: the entry read is trimmed by
// replacing prose that a reader has to interpret with a command that answers "what now" from the same
// state `run:prep` already gathered, so the answer is computed rather than judged.
//
// **This is the manifest, not the whole procedure.** It prints one line — the step the run is at,
// keyed on the three facts `run:prep`'s summary carries (the issue state, whether it stops before its
// commit, and whether a dependency update is owed). The later children of #2166 fold more of the
// prose into commands that read on from here; this one lays the state → step mapping down.

const CLOSED = 'CLOSED'

const ALREADY_DONE_STEP =
	'Issue is CLOSED — nothing to run. Verify it against merged code before starting.'
const LATEST_STEP =
	'Update dependencies first (latest: required), load the dependency-update skill, then implement.'
const HUMAN_REVIEW_STEP =
	'Implement and run the verification gate, then STOP before the commit (needs-human-review).'
const IMPLEMENT_STEP = 'Implement, then run the verification gate (refactor, gate, /code-review).'
const UNKNOWN_STEP =
	'State could not be read — resolve the failure in run:prep before deciding the next step.'

// The four facts a step is keyed on, lifted off `PrepParts` so the mapping is a pure function of state
// and the CLI does the reading. `state` is `undefined` exactly when `run:prep` could not read it.
interface NextInput {
	state: string | undefined
	is_human_review: boolean
	latest_scope: string
}

function to_input(parts: PrepParts): NextInput {
	return {
		state: parts.state?.state,
		is_human_review: parts.state?.is_human_review ?? false,
		latest_scope: parts.latest_scope,
	}
}

// **Ordered guards, because the facts are not independent.** A closed issue is terminal whatever else
// is true; a required update is the earliest action; `needs-human-review` changes where the run ends,
// so it is surfaced ahead of the ordinary implement step. An unreadable state answers last rather than
// falling through to `implement`, which would send a run past a read that failed.
function next_step(input: NextInput): string {
	if (input.state === undefined) return UNKNOWN_STEP
	if (input.state === CLOSED) return ALREADY_DONE_STEP
	if (input.latest_scope === latest_scope_cli.REQUIRED_SCOPE) return LATEST_STEP
	if (input.is_human_review) return HUMAN_REVIEW_STEP

	return IMPLEMENT_STEP
}

function format_report(parts: PrepParts): string {
	return next_step(to_input(parts))
}

const run_next = {
	ALREADY_DONE_STEP,
	HUMAN_REVIEW_STEP,
	IMPLEMENT_STEP,
	LATEST_STEP,
	UNKNOWN_STEP,
	format_report,
	next_step,
	to_input,
}

export type { NextInput }
export { run_next }
