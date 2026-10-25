import {
	EPIC_LABEL,
	has_label_name,
	has_parked_label,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import type { IssueState } from '#scripts/issue/issue-state'
import type { CarryChange, RunCarry } from '#scripts/run/carry/run-carry'
import { run_stalled } from '#scripts/run/park/run-stalled'
import type { ChildOutcome } from './run-merge-outcome'

// The pure core of `run:merge`, the one composite command for a `backlogrun` merge event: the parent —
// the session whose context is largest and per-turn cost highest — calls `run:merge <N>` once at a
// child's return and reads back the next child number, or a control verdict.
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
// Three outages in a row stop the run too — the same shape as the failure
// guard, over its own streak. An outage is a child its environment ended — it could not reach the API
// or its session was killed inside a turn — so a run of them is the environment being down; stopping is
// what keeps the run from re-dispatching into a dead API forever. A ship that stopped with no relaunch
// is re-dispatched too but not counted: its child reached the API (joshuafolkken/kit#3974). A merge or
// a genuine child failure resets it (`run-carry.ts` → `next_outages`).
const CONSECUTIVE_OUTAGE_LIMIT = 3
const ONE = 1

// What a returned child turned out to be, decided from its GitHub state and — for the failed case
// alone — the exit record.
// - `merged`      — CLOSED by a merge; the child finished and its pull request merged. Also an OPEN, unparked
//                   child a merged pull request's `closes #N` names — GitHub merged it without closing
//                   the issue.
// - `human-review` — OPEN and carrying `needs-human-review`; the run's own ending (needs-human-review.md).
// - `parked`      — OPEN and carrying a park label (`PARKED_LABELS`); a person still owns it.
// - `split`       — OPEN and carrying `epic`; its work was divided into new children.
// - `outage`      — OPEN and carrying neither, but the exit record shows it could not reach the API, a
//                   host restart killed it, or its ship stop went unanswered; not the child's failure, so
//                   it is re-dispatchable and uncounted against the failure guard.
// - `cut`         — OPEN and carrying neither, but its lane holds a declared cut no successor adopted;
//                   the child ended its session on purpose, so it is resumed rather than parked and
//                   counts nothing.
// - `unauthenticated` — OPEN and carrying neither, but the exit record shows the session could not
//                   authenticate; no child can run until a person runs `/login`, so the run stops with
//                   the child left `in-progress` and nothing counted (joshuafolkken/kit#4216).
// - `usage-limit` — OPEN and carrying neither, but the exit record shows a Claude usage limit stopped
//                   it; nothing is counted or parked, and the run dispatches again once the limit
//                   resets (joshuafolkken/kit#4745).
// - `failed`      — OPEN and carrying neither, and not an outage; the child did not finish.
// - `withdrawn`   — a person withdrew it with `lane:withdraw`, read from the event stream before the
//                   GitHub state: left OPEN for the next run, it is neither merged nor failed. Also a
//                   CLOSED child no merge closed — closed as not planned, or with no merged pull
//                   request (joshuafolkken/kit#4916).
// - `unresolved`  — the state could not be read; re-read before deciding.
// The names themselves are `run-merge-outcome.ts`'s.

// What the CLI read beside the GitHub state: whether the exit record is an API outage, and whether the
// lane holds a cut its successor never adopted.
interface EndingSignals {
	is_outage: boolean
	is_cut: boolean
	// The merged pull request whose `closes #N` names the child, when GitHub left the child OPEN after
	// merging it.
	merged_pr?: string | undefined
	// The newest launch of the child was withdrawn by a person (`run_event_scope.is_withdrawn`), or its
	// issue was closed without a merge (`run-merge-signals.ts` → `read_is_withdrawn`).
	is_withdrawn?: boolean | undefined
	// The outage is not an API the child could not reach — a ship stop no relaunch answered, or a host
	// restart that killed it — so it is left out of the run-wide streak.
	is_streak_exempt?: boolean | undefined
	// The exit record shows the session could not authenticate (`api-auth.ts`).
	is_auth_failure?: boolean | undefined
	// When a usage limit that stopped the session lets the run dispatch again, in epoch milliseconds
	// (`api-usage-limit.ts`); absent when no usage limit stopped it.
	resume_ms?: number | undefined
	// A re-dispatchable ending the per-child cap turned into `failed`: the line its park leads with
	// (`run-merge-cap.ts`).
	capped_note?: string | undefined
}

const NO_SIGNALS: EndingSignals = { is_outage: false, is_cut: false }

function is_closed(state: IssueState): boolean {
	return state.state.toUpperCase() === CLOSED_STATE
}

// A parked child is one a person still owns (`PARKED_LABELS`): it is left alone and not counted as a
// failure again.
function is_parked(state: IssueState): boolean {
	return has_parked_label(state.labels)
}

// An unfinished child its environment ended: it could not authenticate, a usage limit stopped it, or it
// could not reach the API — read in that order, each more specific than the next.
function environment_outcome(signals: EndingSignals): ChildOutcome {
	if (signals.is_auth_failure === true) return 'unauthenticated'

	if (signals.resume_ms !== undefined) return 'usage-limit'

	return signals.is_outage ? 'outage' : 'failed'
}

// **CLOSED means merged, whatever labels it carries**, once the withdrawal signal has ruled out a close
// no merge made (`classify_child`) — a child that finished and merged keeps the
// `needs-human-review` a person put on it, so that label is read only on an OPEN child
// (`backlogrun-progress.md` → "Running a named epic's children").
// An OPEN, unparked child that is not waiting on a person: a declared cut is resumed, and it is read
// before the outage so a cut whose process then lost the API is still resumed from its record; an
// OPEN, unparked child that could not reach the API is an `outage`, not a `failed`. **A merged pull
// request that closes it is read first**: the work landed and only GitHub's close did not, so it is
// `merged` — never a failure counted against the guard.
function unfinished_outcome(signals: EndingSignals): ChildOutcome {
	if (signals.merged_pr !== undefined) return 'merged'

	if (signals.is_cut) return 'cut'

	return environment_outcome(signals)
}

function open_outcome(state: IssueState, signals: EndingSignals): ChildOutcome {
	if (state.is_human_review) return 'human-review'

	if (has_label_name(state.labels, EPIC_LABEL)) return 'split'

	if (is_parked(state)) return 'parked'

	return unfinished_outcome(signals)
}

// The signals are read by the CLI and, but for a withdrawal, matter only for an OPEN child — a CLOSED
// child arrives already filtered by `is_withdrawn` (its timeline), so one that reaches here is merged
// regardless of how the process exited. **A withdrawal is read first**: `lane:withdraw`
// records it before stopping the child and leaves the issue OPEN, which would otherwise read as a child
// to resume or park.
function classify_child(
	state: IssueState | undefined,
	signals: EndingSignals = NO_SIGNALS,
): ChildOutcome {
	if (signals.is_withdrawn === true) return 'withdrawn'

	if (state === undefined) return 'unresolved'

	if (is_closed(state)) return 'merged'

	return open_outcome(state, signals)
}

// The counter change a child's outcome implies. A merge counts a merge (which resets the failure
// streak); a failure counts a failure; a split, parked, withdrawn or human-review child counts nothing —
// a decision a person made or still owes is not the environment failing — and `undefined` says the
// carry record is left untouched.
function change_of(outcome: ChildOutcome): CarryChange | undefined {
	if (outcome === 'merged') return { merged: ONE }

	if (outcome === 'failed') return { failures: ONE }

	if (outcome === 'outage') return { outages: ONE }

	return undefined
}

function is_guard_tripped(failures: number): boolean {
	return failures >= CONSECUTIVE_FAILURE_LIMIT
}

// The outage guard, over its own streak. Same shape as the failure guard: a
// run of consecutive outages is the environment being down, so the run stops rather than re-dispatching.
function is_outage_guard_tripped(outages: number): boolean {
	return outages >= CONSECUTIVE_OUTAGE_LIMIT
}

// The progress comment, generated from the single-source carry record so the counters live in one
// place and this text is derived rather than a second copy kept alongside it.
// It is script-emitted, so it stays English while the run's session-facing prose follows
// `JOSH_SESSION_LANG`.
function counters_comment(carry: RunCarry): string {
	return [
		'Run progress (generated from the carry record):',
		`- started: ${carry.started_at}`,
		`- merged: ${String(carry.merged)}`,
		`- filed: ${String(carry.filed)}`,
		`- consecutive failures: ${String(carry.failures)}`,
		`- consecutive outages: ${String(carry.outages)}`,
		`- cuts crossed: ${String(carry.cuts)}`,
	].join('\n')
}

// Why the run parked a child it judged failed. A child that stops itself leaves its own comment; one
// the driver stops leaves none, so this tells a person why it carries `run:stalled`.
// Script-emitted, so English.
interface ParkReason {
	child: string
	cause: string
	carry: RunCarry | undefined
	output: string | undefined
}

function streak_line(carry: RunCarry | undefined): string {
	if (carry === undefined) return '- Consecutive failures: not recorded (no carry record).'

	return `- Consecutive failures: ${String(carry.failures)} of ${String(CONSECUTIVE_FAILURE_LIMIT)} (the run stops at ${String(CONSECUTIVE_FAILURE_LIMIT)}).`
}

function park_comment(reason: ParkReason): string {
	const transcript = reason.output === undefined ? '' : ` (\`${reason.output}\`)`

	return [
		`Parked with \`${RUN_STALLED_LABEL}\` by \`pnpm josh run:merge\`, the \`backlogrun\` driver — a mechanical failure, with no decision to make.`,
		`- Why: ${reason.cause}`,
		'- Read: the issue is OPEN, carries no park label, `needs-human-review` or `epic`, no merged pull request’s `closes #N` names it, and it declares no open blocker, start date still ahead or sample condition not yet met.',
		streak_line(reason.carry),
		`- Next: read the child’s transcript${transcript}, ${run_stalled.next_step(reason.child)}.`,
	].join('\n')
}

// Why the run released a child it would otherwise have parked: the child records open blockers or a
// start date still ahead or samples still short, so when it runs is already decided and it waits rather than asking a person.
// Script-emitted, so English.
function waiting_comment(waits: ReadonlyArray<string>): string {
	return [
		'Released to wait by `pnpm josh run:merge`, the `backlogrun` driver — not parked, and not counted as a failure.',
		`- Why: the child’s session ended unfinished while it waits on: ${waits.join(', ')}.`,
		'- Next: when it runs is already recorded — it becomes runnable again once its blockers merge, its start date arrives and its sample condition is met; a blocker outside the backlog still needs a person to land it.',
	].join('\n')
}

const run_merge = {
	CONSECUTIVE_FAILURE_LIMIT,
	CONSECUTIVE_OUTAGE_LIMIT,
	change_of,
	classify_child,
	counters_comment,
	park_comment,
	waiting_comment,
	is_guard_tripped,
	is_outage_guard_tripped,
}

export type { EndingSignals, ParkReason }
export { run_merge }

export { type ChildOutcome } from './run-merge-outcome'
