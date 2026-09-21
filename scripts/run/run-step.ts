import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import type { CarryRead } from './run-carry'
import { run_event_stream } from './run-event-stream'

// `josh run:step <N>` — the run's next single action, computed from three mechanical inputs and nothing
// else (joshuafolkken/kit#2248). It is the child of epic #2166 that lifts the fold from an *event* to a
// whole *run*: `run:next` printed one prose line for a `fullrun`'s pre-implementation position, and the
// backlogrun loop stayed a state machine written in English that the reader rebuilt every turn. This
// computes the position from the event stream (`run-event-stream.ts`), the carry record
// (`run-carry.ts`) and the issue state (`run-prep.ts`) — never the conversation — and prints one line.
//
// **The print is one of two shapes, never a procedure.** A runnable command the reader pastes, or a
// single point a person has to judge (`decide: … — a | b`). The short verdict tokens below are the
// non-command answers, exactly as `backlog:next` prints an issue command or one of its fixed verdicts;
// an issue number is never a verdict token, only the named strings here are.
//
// **It does not re-decide what another command already answers.** A merged child's next step is
// `run:merge`'s to classify, the next backlog issue is `backlog:next`'s, the merge chain is
// `followup`'s — so this dispatches to them rather than cloning their logic. The one thing it owns is
// *which* of them is next, read off the run's own position.

const CLOSED = 'CLOSED'

// The fixed verdict tokens — the non-command, non-decide answers. Kept as the oracle's declared
// vocabulary (joshuafolkken/kit#2248), so `decision-oracle.test.ts` pins the list against these.
const IMPLEMENT = 'implement'
const HUMAN_REVIEW = 'human-review'
const UPDATE_DEPS = 'update-deps'
const ALREADY_DONE = 'already-done'
const WAIT = 'wait'
const STOP = 'stop'
const UNKNOWN = 'unknown'

const VOCABULARY: ReadonlyArray<string> = [
	IMPLEMENT,
	HUMAN_REVIEW,
	UPDATE_DEPS,
	ALREADY_DONE,
	WAIT,
	STOP,
	UNKNOWN,
]

// The whole-run bound is spent, and carrying the budget or discarding it is a person's call — the one
// Tier-B point this machine surfaces rather than choosing.
const EXPIRED_DECISION =
	'decide: whole-run budget spent — resume with `pnpm josh run:carry --resume` | discard with `pnpm josh run:carry --end`'

// The pre-implementation verdict `run:next` degenerates to: the position of a run that has emitted no
// event yet. `run-next.ts` maps each of these to its prose sentence, so this is the single copy of the
// state → step mapping and there is no second implementation (joshuafolkken/kit#2248).
type PreVerdict =
	typeof IMPLEMENT | typeof HUMAN_REVIEW | typeof UPDATE_DEPS | typeof ALREADY_DONE | typeof UNKNOWN

interface PreInput {
	state: string | undefined
	is_human_review: boolean
	latest_scope: string
}

// The three facts the run branches on before its first edit, ordered because they are not independent:
// an unreadable state answers first, a closed issue is terminal, a required update is the earliest
// action, and `needs-human-review` changes where the run ends so it precedes the ordinary implement.
function pre_verdict(input: PreInput): PreVerdict {
	if (input.state === undefined) return UNKNOWN
	if (input.state === CLOSED) return ALREADY_DONE
	if (input.latest_scope === latest_scope_cli.REQUIRED_SCOPE) return UPDATE_DEPS
	if (input.is_human_review) return HUMAN_REVIEW

	return IMPLEMENT
}

interface StepInput extends PreInput {
	// The last event kind on the stream, or `undefined` for a stream with nothing on it. Only the newest
	// event is read: the position is where the run *is*, not how it got there.
	last_event: string | undefined
	carry_kind: CarryRead['kind']
	issue_number: string
}

interface StepAction {
	kind: 'command' | 'verdict' | 'decide'
	line: string
}

function verdict(token: string): StepAction {
	return { kind: 'verdict', line: token }
}

function command(line: string): StepAction {
	return { kind: 'command', line }
}

// The action for each event a run can be positioned at, keyed on the newest one. Each dispatches to the
// command that owns that phase; `child-launch` and `stop` are the two positions with no command to run
// — the parent waits for its child, or the run has already stopped. A merge and an outage share a next
// step: `run:merge` classifies both, including the outage's stop condition.
const KIND = run_event_stream.EVENT_KIND
const EVENT_ACTIONS: Record<string, (issue_number: string) => StepAction> = {
	[KIND.PR_OPENED]: () => command('pnpm josh followup'),
	[KIND.REVIEW_ROUND]: () => command('pnpm josh review:round2'),
	[KIND.MERGE]: (issue_number) => command(`pnpm josh run:merge ${issue_number}`),
	[KIND.OUTAGE]: (issue_number) => command(`pnpm josh run:merge ${issue_number}`),
	[KIND.PARK]: () => command('pnpm josh backlog:next'),
	[KIND.CUT]: (issue_number) => command(`pnpm josh run:cut --resume ${issue_number}`),
	[KIND.CHILD_LAUNCH]: () => verdict(WAIT),
	[KIND.STOP]: () => verdict(STOP),
}

// An event the table does not name leaves the position unknown rather than guessing a next step.
function event_action(event: string, issue_number: string): StepAction {
	return EVENT_ACTIONS[event]?.(issue_number) ?? verdict(UNKNOWN)
}

// A run that has planned but emitted nothing else is still at its pre-implementation position, so a
// `plan` reads the same as an empty stream.
function is_pre_implementation(last_event: string | undefined): boolean {
	return last_event === undefined || last_event === run_event_stream.EVENT_KIND.PLAN
}

// The terminal answers read before the run's position matters: an unreadable carry record leaves the
// position unknowable, a spent budget is the person's call, and the issue's own state can end the run
// whatever the events say. `undefined` when none applies and the position decides.
function terminal_action(input: StepInput): StepAction | undefined {
	if (input.carry_kind === 'unreadable') return verdict(UNKNOWN)
	if (input.carry_kind === 'expired') return { kind: 'decide', line: EXPIRED_DECISION }
	if (input.state === undefined) return verdict(UNKNOWN)
	if (input.state === CLOSED) return verdict(ALREADY_DONE)

	return undefined
}

// The one entry point: the run's next action, from the three inputs and nothing else. A terminal answer
// wins first; otherwise a run with nothing emitted yet is at its pre-implementation position, and a run
// that has begun is placed by its newest event.
function next_action(input: StepInput): StepAction {
	const terminal = terminal_action(input)

	if (terminal !== undefined) return terminal
	if (is_pre_implementation(input.last_event)) return verdict(pre_verdict(input))

	return event_action(input.last_event ?? '', input.issue_number)
}

const run_step = {
	ALREADY_DONE,
	EXPIRED_DECISION,
	HUMAN_REVIEW,
	IMPLEMENT,
	STOP,
	UNKNOWN,
	UPDATE_DEPS,
	VOCABULARY,
	WAIT,
	next_action,
	pre_verdict,
}

export type { PreInput, PreVerdict, StepAction, StepInput }
export { run_step }
