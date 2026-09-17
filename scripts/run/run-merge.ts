import { ALREADY_DONE_LABEL, has_label_name, NEEDS_DECISION_LABEL } from '#scripts/git/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import type { CarryChange, RunCarry } from './run-carry'

// joshuafolkken/kit#2024: a `backlogrun` merge event was two parent turns — a reading turn and an
// acting turn — spent at the session whose context is largest and whose per-turn cost is highest.
// This is the pure core of the one composite command that collapses it: the parent calls
// `run:merge <N>` once at a child's return and reads back the next child number, or a control verdict.
//
// Everything here is pure — the classification of the returned child, the counter change that outcome
// implies, the consecutive-failure guard, and the progress-comment text generated from the
// single-source carry record. The side effects (`main:sync`, `lane:close`, the comment write, the
// label edits, `epic:next` / `backlog:next`) are the CLI's, so the branches this file decides are
// unit-tested without a network — `merged`, `parked`, `failed`, `human-review`, `unresolved`.

const CLOSED_STATE = 'CLOSED'
// Three failures in a row stop the run — the figure `backlogrun-progress.md` states in prose. A merge
// resets the streak (`run-carry.ts` → `next_failures`), so the guard trips only on an environment
// failing every child it is handed rather than on failures scattered across a long run.
const CONSECUTIVE_FAILURE_LIMIT = 3
const ONE = 1

// What a returned child turned out to be, decided from its GitHub state alone.
// - `merged`      — CLOSED; the child finished and its pull request merged.
// - `human-review` — OPEN and carrying `needs-human-review`; the run's own ending (SKILL.md → §2z).
// - `parked`      — OPEN and carrying `needs-decision` or `already-done`; a person still owns it.
// - `failed`      — OPEN and carrying neither; the child did not finish.
// - `unresolved`  — the state could not be read; re-read before deciding.
type ChildOutcome = 'merged' | 'human-review' | 'parked' | 'failed' | 'unresolved'

function is_closed(state: IssueState): boolean {
	return state.state.toUpperCase() === CLOSED_STATE
}

// A parked child is one a person still owns: it stopped for a decision (`needs-decision`) or it was
// found already merged (`already-done`). Either way it is left alone and not counted as a failure.
const PARK_LABELS: ReadonlyArray<string> = [NEEDS_DECISION_LABEL, ALREADY_DONE_LABEL]

function is_parked(state: IssueState): boolean {
	return PARK_LABELS.some((label) => has_label_name(state.labels, label))
}

// **CLOSED means merged, whatever labels it carries** — a child that finished and merged keeps the
// `needs-human-review` a person put on it, so that label is read only on an OPEN child
// (`backlogrun-progress.md` → "Running a named epic's children").
function classify_child(state: IssueState | undefined): ChildOutcome {
	if (state === undefined) return 'unresolved'

	if (is_closed(state)) return 'merged'

	if (state.is_human_review) return 'human-review'

	return is_parked(state) ? 'parked' : 'failed'
}

// The counter change a child's outcome implies. A merge counts a merge (which resets the failure
// streak); a failure counts a failure; a parked or human-review child counts nothing — a decision
// waiting on a person is not the environment failing — and `undefined` says the carry record is left
// untouched.
function change_of(outcome: ChildOutcome): CarryChange | undefined {
	if (outcome === 'merged') return { merged: ONE }

	if (outcome === 'failed') return { failures: ONE }

	return undefined
}

function is_guard_tripped(failures: number): boolean {
	return failures >= CONSECUTIVE_FAILURE_LIMIT
}

// The progress comment, generated from the single-source carry record so the counters live in one
// place and this text is derived rather than a second copy kept alongside it (joshuafolkken/kit#2024).
// It is script-emitted, so it stays English while the run's session-facing prose follows
// `JOSH_SESSION_LANG`.
function counters_comment(carry: RunCarry): string {
	return [
		'Run progress (generated from the carry record):',
		`- started: ${carry.started_at}`,
		`- merged: ${String(carry.merged)}`,
		`- filed: ${String(carry.filed)}`,
		`- consecutive failures: ${String(carry.failures)}`,
		`- cuts crossed: ${String(carry.cuts)}`,
	].join('\n')
}

const run_merge = {
	CONSECUTIVE_FAILURE_LIMIT,
	change_of,
	classify_child,
	counters_comment,
	is_guard_tripped,
}

export type { ChildOutcome }
export { run_merge }
