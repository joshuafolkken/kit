import { git_stash } from '#scripts/git/stash/git-stash'
import { session_cite } from '#scripts/issue/session-cite'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { latest_scope_cli } from '#scripts/version/latest-scope-cli'
import { run_retrospective } from './run-retrospective'

// `josh run:step <N>` — the run's next single action, computed from three mechanical inputs and nothing
// else, so the run's loop is not a state machine written in English that the reader rebuilds every
// turn. This computes the position from the event stream (`run-event-stream.ts`), the carry record
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
// vocabulary, so `decision-oracle.test.ts` pins the list against these.
const IMPLEMENT = 'implement'
const HUMAN_REVIEW = 'human-review'
const UPDATE_DEPS = 'update-deps'
const ALREADY_DONE = 'already-done'
// A closed issue whose lane tree still holds uncommitted work — `run:step`
// itself prints the `decide:` line naming the stash, and this is the token `run:entry` reports.
const KEEP_WORK = 'keep-work'
const WAIT = 'wait'
const STOP = 'stop'
const UNKNOWN = 'unknown'

const VOCABULARY: ReadonlyArray<string> = [
	IMPLEMENT,
	HUMAN_REVIEW,
	UPDATE_DEPS,
	ALREADY_DONE,
	KEEP_WORK,
	WAIT,
	STOP,
	UNKNOWN,
]

// The whole-run bound is spent, and carrying the budget or discarding it is a person's call — the one
// Tier-B point this machine surfaces rather than choosing.
const EXPIRED_DECISION =
	'decide: whole-run budget spent — resume with `pnpm josh run:carry --resume` | discard with `pnpm josh run:carry --end`'

// The one step a stopped run still owes before it ends: the end-of-run retrospective.
// It reads the run's own measurements and files the improvements worth carrying into the next run;
// the command is kit-only, so it means nothing — and is never printed — in a consumer project.
const RETROSPECTIVE_COMMAND = 'pnpm josh retrospective'

// The pre-implementation verdict `run:next` degenerates to: the position of a run that has emitted no
// event yet. `run-next.ts` maps each of these to its prose sentence, so this is the single copy of the
// state → step mapping and there is no second implementation.
type PreVerdict =
	| typeof IMPLEMENT
	| typeof HUMAN_REVIEW
	| typeof UPDATE_DEPS
	| typeof ALREADY_DONE
	| typeof KEEP_WORK
	| typeof UNKNOWN

interface PreInput {
	state: string | undefined
	is_human_review: boolean
	latest_scope: string
	// Whether a lane child's tree holds uncommitted work, read by `run:prep`'s gather.
	// A closed issue over such a tree is not "nothing to do": the work was popped back from a park and
	// is lost with the lane unless it is kept, so `already-done` gives way to `keep-work`.
	has_changes: boolean
}

function closed_verdict(input: PreInput): typeof ALREADY_DONE | typeof KEEP_WORK {
	return input.has_changes ? KEEP_WORK : ALREADY_DONE
}

// The three facts the run branches on before its first edit, ordered because they are not independent:
// an unreadable state answers first, a closed issue is terminal, a required update is the earliest
// action, and `needs-human-review` changes where the run ends so it precedes the ordinary implement.
function pre_verdict(input: PreInput): PreVerdict {
	if (input.state === undefined) return UNKNOWN
	if (input.state === CLOSED) return closed_verdict(input)
	if (input.latest_scope === latest_scope_cli.REQUIRED_SCOPE) return UPDATE_DEPS
	if (input.is_human_review) return HUMAN_REVIEW

	return IMPLEMENT
}

interface StepInput extends PreInput {
	// The last event kind on the stream, or `undefined` for a stream with nothing on it. Only the newest
	// event is read: the position is where the run *is*, not how it got there.
	last_event: string | undefined
	carry_kind: CarryRead['kind']
	// Whether this invocation's end-of-run retrospective has already run, read off the carry record.
	// At the stop position it is what tells a run that still owes a
	// retrospective from one that has run it, so the step is printed exactly once.
	is_retrospective_done: boolean
	// Whether this checkout is a kit consumer rather than kit itself. The
	// retrospective command is kit-only — refused in a consumer — so the step is never printed there; the
	// consumer determination is the existing `doctor-consumer.ts` one, never a new judgement.
	is_consumer: boolean
	issue_number: string
	// Whether this run is a dispatched lane child, read by the CLI from the dispatch mark
	// (`lane-child-marker.ts`). A child must never be handed `run:merge` — that is the parent's own
	// budget command and returns `busy` in a child.
	is_lane_child: boolean
	// Whether the end-of-run retrospective is switched on, read by the CLI from `JOSH_RETROSPECTIVE`.
	// It defaults **off** — the auto-filed improvement issues the step drives
	// are opt-in — so a run that leaves the variable unset never prints the retrospective step, while the
	// retrospective's own logic is untouched and `pnpm josh retrospective` still runs by hand.
	is_retrospective_enabled: boolean
	// Whether this session is woken when a background command it started completes, read by the CLI from
	// the session's own environment. A parent without the callback cannot wait
	// on its lanes except by polling, so it hands the run to the supervisor instead of waiting.
	has_completion_callback: boolean
	// Whether the carried invocation has already taken its maximum cuts, read off the carry record by the
	// CLI. At the cap `run:carry --cut` refuses, so the hand-off is not offered.
	is_at_cut_cap: boolean
	// Whether the carry record has been handed off by a cut and no successor has adopted it yet, read off
	// the record by the CLI and set only in the session that declared the record.
	// The session that took the cut is the only one that can read this — a successor spends the mark when
	// it begins — so it is what tells that session to stop.
	is_handed_off: boolean
	// Whether this run launched the issue and its stream holds no `merge` for it yet, read by the CLI.
	// A parent that reads a closed child as `already-done` never runs
	// `run:merge`, so the merge is never written and `run:board` shows the child running forever.
	is_merge_owed: boolean
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

function merge_command(issue_number: string): StepAction {
	return command(`pnpm josh run:merge ${issue_number}`)
}

// The action for each event a run can be positioned at, keyed on the newest one. Each dispatches to the
// command that owns that phase. `stop`, `drain` and `child-launch` are handled apart in
// `FULL_INPUT_ACTIONS`, because each needs more than the issue number. A merge and an outage share a
// next step: `run:merge` classifies both, including the outage's stop condition.
const KIND = run_event_stream.EVENT_KIND
// A park and a stall share this next step: both mean runnable work is waiting to be offered,
// so both are pointed at the backlog.
const OFFER_BACKLOG = 'pnpm josh backlog:next'
const EVENT_ACTIONS: Record<string, (issue_number: string) => StepAction> = {
	[KIND.PR_OPENED]: () => command('pnpm josh followup'),
	[KIND.REVIEW_ROUND]: () => command('pnpm josh review:round2'),
	[KIND.MERGE]: merge_command,
	[KIND.OUTAGE]: merge_command,
	[KIND.PARK]: () => command(OFFER_BACKLOG),
	[KIND.CUT]: (issue_number) => command(`pnpm josh run:cut --resume ${issue_number}`),
	// A stall is undispatched ready work with a free lane, so its next step is exactly a park's: offer
	// the backlog. The detector only reports the stall; reading it here as a dispatch is what turns the
	// report into the action that resolves it.
	[KIND.STALL]: () => command(OFFER_BACKLOG),
	// The post-implementation region is with a detached ship supervisor: nothing
	// is the agent's until the supervisor stops or the issue closes, which the terminal read answers.
	[KIND.SHIP_LAUNCH]: () => verdict(WAIT),
	// The supervisor stopped at a failed stage and handed control back — the next step is reading the
	// report it stopped on, which names the stage and why.
	[KIND.SHIP_STOP]: (issue_number) => command(`pnpm josh ship --log ${issue_number}`),
}

// The parent-only positions a dispatched lane child must never act on. `run:merge` is the parent's
// budget command — a child that ran it would read the `busy` it got back as a competing session and
// park its Issue unimplemented. A merge or an outage is the parent's to classify, so a child at one
// has nothing to run and stops rather than being handed `run:merge`.
const PARENT_ONLY_EVENTS: ReadonlySet<string> = new Set([KIND.MERGE, KIND.OUTAGE])

// A stopped run's last owed step is the end-of-run retrospective. When it is not owed the position stops
// with no command to run.
function stop_action(input: StepInput): StepAction {
	return run_retrospective.is_owed(input) ? command(RETROSPECTIVE_COMMAND) : verdict(STOP)
}

// The drain fires the retrospective *before* the idle watch, not after it: the
// retrospective files the improvement issues the watch then picks up, so running it after the watch
// would spend the watch on an empty pool. When the retrospective is not owed the
// run proceeds to that watch, which is a `WAIT` rather than a `STOP`: the backlog is empty but the run is
// not ending, and the real `STOP` follows when the watch expires with the retrospective already done.
function drain_action(input: StepInput): StepAction {
	return run_retrospective.is_owed(input) ? command(RETROSPECTIVE_COMMAND) : verdict(WAIT)
}

// The hand-off a `backlogrun` parent without a completion callback takes right after dispatching.
// It is the existing merge-time cut, so the ownership check and the cut cap
// apply unchanged, and the supervisor's driver adopts the in-flight lanes from their `child-launch`
// events.
const HAND_OFF_COMMAND = 'pnpm josh run:carry --cut --owner "$PPID"'

// After a dispatch the parent waits for its child — where waiting is free. A session the completion
// does not re-invoke could only wait by polling, each poll a model call over its whole context, so a
// `backlogrun` parent there hands the carry record to the supervisor instead. A lane child and a run
// with no carry record have nothing to hand off, so both still wait; so does a run at the cut cap, whose
// cut would be refused on every ask and leave the carry record with nobody.
function can_hand_off(input: StepInput): boolean {
	if (input.is_lane_child || input.is_at_cut_cap) return false

	return input.carry_kind === 'carried' && !input.has_completion_callback
}

function child_launch_action(input: StepInput): StepAction {
	return can_hand_off(input) ? command(HAND_OFF_COMMAND) : verdict(WAIT)
}

// The positions whose action needs the whole input rather than the issue number — a stop and a drain
// both turn on whether the retrospective is still owed, a child launch on whether waiting is free. Kept
// in a map so `next_action` dispatches them in one branch rather than one `if` apiece.
const FULL_INPUT_ACTIONS: Record<string, (input: StepInput) => StepAction> = {
	[KIND.STOP]: stop_action,
	[KIND.DRAIN]: drain_action,
	[KIND.CHILD_LAUNCH]: child_launch_action,
}

// An event the table does not name leaves the position unknown rather than guessing a next step. A
// lane child at a parent-only position stops instead — the runtime refusal `lane-carry-conflict.ts`
// delivers is the same rule one call later, so this keeps a child from ever being pointed at it. The
// stop position is dispatched by `next_action`, so it is not among the events this handles.
function event_action(event: string, issue_number: string, is_lane_child: boolean): StepAction {
	if (is_lane_child && PARENT_ONLY_EVENTS.has(event)) return verdict(STOP)

	return EVENT_ACTIONS[event]?.(issue_number) ?? verdict(UNKNOWN)
}

// A run that has planned but emitted nothing else is still at its pre-implementation position, so a
// `plan` reads the same as an empty stream. A resume from an implementation cut is back at the same
// position: read as the `cut` it follows, it would point at the spent resume again.
const IMPLEMENTATION_POSITIONS: ReadonlySet<string> = new Set([KIND.PLAN, KIND.RESUME])

function is_pre_implementation(last_event: string | undefined): boolean {
	return last_event === undefined || IMPLEMENTATION_POSITIONS.has(last_event)
}

// **No cut at the setup→implementation boundary**. A lane child's context is
// bounded by the threshold-gated implementation cut alone (`implementation-cut.ts`): the first edit is
// the moment both would have looked at, and below the threshold a cut there is one that does not pay
// for itself (`context-cut-payback.ts`), so a planned lane child implements in the same session.
function pre_implementation_action(input: StepInput): StepAction {
	return verdict(pre_verdict(input))
}

// A parent whose child closed before `run:merge` wrote the merge still owes it:
// `run:merge` is the one writer of the `merge` event, so answering `already-done` here would leave the
// child running on `run:board` forever. A lane child is never handed `run:merge`.
function owes_merge(input: StepInput): boolean {
	return input.is_merge_owed && input.carry_kind === 'carried' && !input.is_lane_child
}

// A closed issue ends the run, but a tree still holding uncommitted work is surfaced rather than
// answered `already-done` — the answer a child reads as "nothing to do" before its lane is removed
// with the work in it.
function closed_action(input: StepInput): StepAction {
	if (owes_merge(input)) return merge_command(input.issue_number)
	if (closed_verdict(input) === ALREADY_DONE) return verdict(ALREADY_DONE)

	const message = git_stash.work_message(input.issue_number, ALREADY_DONE)

	return {
		kind: 'decide',
		line: `decide: ${session_cite.issue(input.issue_number)} is closed but this tree holds uncommitted work — keep it with \`git stash push -u -m "${message}"\` | carry it into a new issue`,
	}
}

// **A cut hands the run on, so the session that took it stops** — otherwise it would go on answering
// `wait` or the next offer after `run:carry --cut`, launching children in the same conversation. A
// lane child never holds the carry record, so its own position is not decided here.
function is_handed_off_parent(input: StepInput): boolean {
	return input.is_handed_off && input.carry_kind === 'carried' && !input.is_lane_child
}

// The carry record's terminal answers: an unreadable record leaves the position unknowable, a handed-off
// run is its successor's, and a spent budget is the person's call.
function carry_terminal_action(input: StepInput): StepAction | undefined {
	if (input.carry_kind === 'unreadable') return verdict(UNKNOWN)
	if (is_handed_off_parent(input)) return verdict(STOP)
	if (input.carry_kind === 'expired') return { kind: 'decide', line: EXPIRED_DECISION }

	return undefined
}

// The terminal answers read before the run's position matters: the carry record's first, then the
// issue's own state, which can end the run whatever the events say. `undefined` when none applies and
// the position decides.
function terminal_action(input: StepInput): StepAction | undefined {
	const carry_action = carry_terminal_action(input)

	if (carry_action !== undefined) return carry_action
	if (input.state === undefined) return verdict(UNKNOWN)
	if (input.state === CLOSED) return closed_action(input)

	return undefined
}

// The one entry point: the run's next action, from the three inputs and nothing else. A terminal answer
// wins first; otherwise a run with nothing emitted yet is at its pre-implementation position, and a run
// that has begun is placed by its newest event.
function next_action(input: StepInput): StepAction {
	const terminal = terminal_action(input)

	if (terminal !== undefined) return terminal
	if (is_pre_implementation(input.last_event)) return pre_implementation_action(input)

	const event = input.last_event ?? ''
	const full_input_action = FULL_INPUT_ACTIONS[event]

	if (full_input_action !== undefined) return full_input_action(input)

	return event_action(event, input.issue_number, input.is_lane_child)
}

const run_step = {
	ALREADY_DONE,
	EXPIRED_DECISION,
	HAND_OFF_COMMAND,
	HUMAN_REVIEW,
	IMPLEMENT,
	KEEP_WORK,
	RETROSPECTIVE_COMMAND,
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
