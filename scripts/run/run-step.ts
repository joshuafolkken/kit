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

// The one step a stopped run still owes before it ends: the end-of-run retrospective
// (joshuafolkken/kit#2328). It reads the run's own measurements and files the improvements worth
// carrying into the next run; the command is kit-only, so it means nothing — and is never printed — in a
// consumer project.
const RETROSPECTIVE_COMMAND = 'pnpm josh retrospective'

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
	// Whether this invocation's end-of-run retrospective has already run, read off the carry record
	// (joshuafolkken/kit#2328). At the stop position it is what tells a run that still owes a
	// retrospective from one that has run it, so the step is printed exactly once.
	is_retrospective_done: boolean
	// Whether this checkout is a kit consumer rather than kit itself (joshuafolkken/kit#2328). The
	// retrospective command is kit-only — refused in a consumer — so the step is never printed there; the
	// consumer determination is the existing `doctor-consumer.ts` one, never a new judgement.
	is_consumer: boolean
	issue_number: string
	// Whether this run is a dispatched lane child, read by the CLI from the dispatch mark
	// (`lane-child-marker.ts`). A child must never be handed `run:merge` — that is the parent's own
	// budget command and returns `busy` in a child (joshuafolkken/kit#2267, joshuafolkken/kit#2297).
	is_lane_child: boolean
	// Whether the end-of-run retrospective is switched on, read by the CLI from `JOSH_RETROSPECTIVE`
	// (joshuafolkken/kit#2370). It defaults **off** — the auto-filed improvement issues the step drives
	// are opt-in — so a run that leaves the variable unset never prints the retrospective step, while the
	// retrospective's own logic is untouched and `pnpm josh retrospective` still runs by hand.
	is_retrospective_enabled: boolean
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
// command that owns that phase; `child-launch` is the one position with no command to run — the parent
// waits for its child. `stop` and `drain` are handled apart in `stop_action` / `drain_action`, because
// whether either still owes a retrospective needs more than the issue number. A merge and an outage share a next step: `run:merge`
// classifies both, including the outage's stop condition.
const KIND = run_event_stream.EVENT_KIND
// A park and a stall share this next step: both mean runnable work is waiting to be offered
// (joshuafolkken/kit#2359), so both are pointed at the backlog.
const OFFER_BACKLOG = 'pnpm josh backlog:next'
const EVENT_ACTIONS: Record<string, (issue_number: string) => StepAction> = {
	[KIND.PR_OPENED]: () => command('pnpm josh followup'),
	[KIND.REVIEW_ROUND]: () => command('pnpm josh review:round2'),
	[KIND.MERGE]: (issue_number) => command(`pnpm josh run:merge ${issue_number}`),
	[KIND.OUTAGE]: (issue_number) => command(`pnpm josh run:merge ${issue_number}`),
	[KIND.PARK]: () => command(OFFER_BACKLOG),
	[KIND.CUT]: (issue_number) => command(`pnpm josh run:cut --resume ${issue_number}`),
	[KIND.CHILD_LAUNCH]: () => verdict(WAIT),
	// A stall is undispatched ready work with a free lane, so its next step is exactly a park's: offer
	// the backlog. The detector only reports the stall; reading it here as a dispatch is what turns the
	// report into the action that resolves it.
	[KIND.STALL]: () => command(OFFER_BACKLOG),
	// The post-implementation region is with a detached ship supervisor (joshuafolkken/kit#2428): nothing
	// is the agent's until the supervisor stops or the issue closes, which the terminal read answers.
	[KIND.SHIP_LAUNCH]: () => verdict(WAIT),
	// The supervisor stopped at a failed stage and handed control back — the next step is reading the
	// report it stopped on, which names the stage and why.
	[KIND.SHIP_STOP]: (issue_number) => command(`pnpm josh ship --log ${issue_number}`),
}

// The parent-only positions a dispatched lane child must never act on. `run:merge` is the parent's
// budget command — a child that ran it read the `busy` it got back as a competing session and parked
// its Issue unimplemented (joshuafolkken/kit#2267). A merge or an outage is the parent's to classify,
// so a child at one has nothing to run and stops rather than being handed `run:merge`
// (joshuafolkken/kit#2297).
const PARENT_ONLY_EVENTS: ReadonlySet<string> = new Set([KIND.MERGE, KIND.OUTAGE])

// Whether a run at a winding-down position still owes its end-of-run retrospective
// (joshuafolkken/kit#2328) — false when the switch is off (the opt-in default, joshuafolkken/kit#2370),
// for a dispatched lane child, where the batch runs one at its own end and never a child's (the
// `release:scope` precedent), for a run whose retrospective has already run this invocation, and in a
// consumer checkout, where the kit-only command is refused. The switch is read first, so a run that has
// not opted in never consults the other three. The two positions that consult it are the drain and the
// stop; both read exactly this, so the exclusion set is single-sourced.
function is_retrospective_owed(input: StepInput): boolean {
	if (!input.is_retrospective_enabled) return false

	return !input.is_lane_child && !input.is_retrospective_done && !input.is_consumer
}

// A stopped run's last owed step is the end-of-run retrospective. When it is not owed the position stops
// with no command to run, which is what the position meant before the retrospective existed.
function stop_action(input: StepInput): StepAction {
	return is_retrospective_owed(input) ? command(RETROSPECTIVE_COMMAND) : verdict(STOP)
}

// The drain fires the retrospective *before* the idle watch, not after it (joshuafolkken/kit#2335): the
// retrospective files the improvement issues the watch then picks up, so running it after the watch — as
// the stop position alone did — spent the watch on an empty pool. When the retrospective is not owed the
// run proceeds to that watch, which is a `WAIT` rather than a `STOP`: the backlog is empty but the run is
// not ending, and the real `STOP` follows when the watch expires with the retrospective already done.
function drain_action(input: StepInput): StepAction {
	return is_retrospective_owed(input) ? command(RETROSPECTIVE_COMMAND) : verdict(WAIT)
}

// The two positions whose action needs the whole input rather than the issue number — a stop and a
// drain both turn on whether the retrospective is still owed. Kept in a map so `next_action` dispatches
// them in one branch rather than one `if` apiece (`is_retrospective_owed` is the shared gate).
const FULL_INPUT_ACTIONS: Record<string, (input: StepInput) => StepAction> = {
	[KIND.STOP]: stop_action,
	[KIND.DRAIN]: drain_action,
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
// `plan` reads the same as an empty stream.
function is_pre_implementation(last_event: string | undefined): boolean {
	return last_event === undefined || last_event === run_event_stream.EVENT_KIND.PLAN
}

// **The setup→implementation boundary, decided here in the run driver rather than in prose**
// (joshuafolkken/kit#2346). A dispatched lane child that has posted its plan has finished setup — it
// has read the skill, the manual documents and the issue, ~130,000 tokens that every later request
// would otherwise re-read — so its next step is to cut before implementing rather than to implement in
// the same session. The position is exactly the `plan` event: an empty stream is a run still in setup,
// and a `cut` event already past it. The verdict must be `implement`, so a `needs-human-review`,
// `update-deps` or closed position — which change where the run goes, not where it cuts — is untouched.
function is_setup_cut_position(input: StepInput, token: PreVerdict): boolean {
	return (
		input.last_event === run_event_stream.EVENT_KIND.PLAN &&
		input.is_lane_child &&
		token === IMPLEMENT
	)
}

function pre_implementation_action(input: StepInput): StepAction {
	const token = pre_verdict(input)

	if (is_setup_cut_position(input, token)) {
		return command(`pnpm josh run:cut ${input.issue_number} --setup`)
	}

	return verdict(token)
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
	if (is_pre_implementation(input.last_event)) return pre_implementation_action(input)

	const event = input.last_event ?? ''
	const full_input_action = FULL_INPUT_ACTIONS[event]

	if (full_input_action !== undefined) return full_input_action(input)

	return event_action(event, input.issue_number, input.is_lane_child)
}

const run_step = {
	ALREADY_DONE,
	EXPIRED_DECISION,
	HUMAN_REVIEW,
	IMPLEMENT,
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
