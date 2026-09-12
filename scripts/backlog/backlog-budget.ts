// `josh backlog:budget` — whether a `backlogrun` may start more work, keep watching, or finish
// (joshuafolkken/kit#1632).
//
// `backlog:next` says what may start; it says nothing about when the run itself should end. Before
// this existed a `backlogrun` had exactly two endings and neither could be declared in advance: it
// finished the moment the backlog read empty, so an issue a person opted in three minutes later
// needed a whole new session, or it ran to the 8-hour whole-run bound, which is a limit on waiting
// rather than a statement of scale.
//
// **The idle watch is on by default and the maximum is not** (joshuafolkken/kit#1676). A
// `backlogrun` with neither flag given watches an empty backlog for `DEFAULT_IDLE_MINUTES` before it
// finishes, and takes as many issues as the backlog holds. `--idle 0` is how the watch is turned off.
//
// The decision is a command's rather than the loop's own arithmetic, for the reason `josh delegate`
// and `josh review:level` are commands: a count and an elapsed time kept in an agent's head are a
// one-shot judgement, and joshuafolkken/kit#1460 measured exactly that failure — a threshold asked
// once and then never again while the run walked past it eight times.

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
// `epicrun.md` → "Waiting, and never waiting forever" carried this as prose only. Held here it is
// the same bound, decided the same way as the two new ones rather than by an agent reading a clock.
const WHOLE_RUN_BUDGET_HOURS = 8
const WHOLE_RUN_BUDGET_MINUTES = WHOLE_RUN_BUDGET_HOURS * MINUTES_PER_HOUR
const WHOLE_RUN_BUDGET_MS = WHOLE_RUN_BUDGET_MINUTES * MS_PER_MINUTE

// **The default idle watch, and why it is this number** (joshuafolkken/kit#1676). The documents used
// 30 as an example, and an example is not a reason; these three are.
//
// - **Below it the watch is a coin flip.** What it waits for is a person noticing the run has gone
//   quiet, filing an issue and applying `auto-ok`. Ten minutes does not reliably outlast that.
// - **Above it the run pays for nothing.** At `IDLE_POLL_MINUTES` a 30-minute watch is six asks —
//   about one child's worth of turns, spent while the run holds no working tree and no lane.
// - **It is about the length of one child** — 12 to 28 minutes measured on joshuafolkken/kit#1477 —
//   so a run that has emptied its backlog waits roughly as long as one more issue would have taken.
const DEFAULT_IDLE_MINUTES = 30
const DEFAULT_IDLE_MS = DEFAULT_IDLE_MINUTES * MS_PER_MINUTE

// **What a watching run sleeps between asks, and it is not the loop's 60-second polling interval.**
// That one is sized to a child's `fullrun`, which finishes in minutes; a watch is waiting on a person
// to file an issue and opt it in, which happens on human timescales. Polling a watch every minute
// would spend thirty of the parent session's own requests — each one billing the whole session
// history — to learn nothing thirty times. `epicrun.md` → "Waiting, and never waiting forever" holds
// the row; the figure is here because `idle_watch_reason` below has to say it.
const IDLE_POLL_MINUTES = 5

const RUN_VERDICT = 'run'
const WATCH_VERDICT = 'watch'
const STOP_VERDICT = 'stop'

// `run` — start what `backlog:next` offered. `watch` — sleep the polling interval and ask again,
// except while something of the run's own is in flight, where the wake is the progress watcher's exit
// and the interval is only a floor (`epicrun.md` → "The wake exists only while something is in
// flight").
// `stop` — report and finish. There is no fourth: an answer the loop cannot act on is a verdict
// nobody can write a loop against.
type BudgetVerdict = typeof RUN_VERDICT | typeof WATCH_VERDICT | typeof STOP_VERDICT

// What `backlog:next` answered, in the words this decision needs. The mapping is mechanical and is
// written once, in `backlogrun.md` → "The loop": numbers are `candidates`, `wait` is `blocked` while
// this run has children in flight and `exhausted` when it does not, `none` is `exhausted`, `stop` is
// `parked`, and `error` or a failed listing is `unreadable`.
const ANSWERS = ['blocked', 'candidates', 'exhausted', 'parked', 'unreadable'] as const

type BacklogAnswer = (typeof ANSWERS)[number]

interface BudgetInput {
	answer: BacklogAnswer
	// Issues this run has merged so far.
	merged: number
	// Children this run has started that have not merged yet. Counted against the maximum alongside
	// the merged ones, because children run in lanes: a wave started before any of them merged would
	// otherwise be measured against a maximum that cannot see it.
	running: number
	started_at_ms: number
	// When this run last had work — the most recent ask that was not `exhausted`, or the run's start.
	// Refreshing it is what restarts the idle watch when a candidate appears during one.
	active_at_ms: number
	now_ms: number
	// `undefined` means unlimited. Named rather than optional: `exactOptionalPropertyTypes` makes an
	// optional property that also admits `undefined` redundant to write and to read (Sonar S4782), and
	// every construction site here knows whether a budget was given.
	max_issues: number | undefined
	// `undefined` means the idle watch is off, which is what `--idle 0` asks for. The default is on:
	// the command resolves an absent `--idle` to `DEFAULT_IDLE_MS` before it reaches here.
	idle_budget_ms: number | undefined
}

interface BudgetDecision {
	verdict: BudgetVerdict
	reason: string
}

const WHOLE_RUN_REASON = `The whole-run bound of ${String(WHOLE_RUN_BUDGET_HOURS)} hours has passed. An unattended run that has not finished overnight needs a person, not more waiting.`

const PARKED_REASON =
	'Nothing opted in can proceed without a person. Report the parked issues and finish.'

const UNREADABLE_REASON =
	'The backlog listing could not be read, so nothing was offered. Report what the command printed and finish — it is not an empty backlog.'

const BLOCKED_REASON =
	'Everything opted in is blocked or already running, so waiting can still change the answer. Poll again at the polling interval.'

const NO_IDLE_WATCH_REASON =
	'The backlog is empty and the idle watch was turned off with `--idle 0`, so the run finishes here.'

function to_minutes(duration_ms: number): string {
	return String(Math.ceil(duration_ms / MS_PER_MINUTE))
}

// Every count below is written as a trailing clause rather than as the subject of a sentence, so a
// reason built from 1 reads as well as one built from 5. These strings are quoted verbatim into the
// completion report, where "1 issues have merged" is what a person actually sees.
function max_reached_reason(merged: number, max_issues: number): string {
	return `This run's maximum of ${String(max_issues)} is reached, with ${String(merged)} merged. Report what was done, including how many were picked up during an idle watch, and finish.`
}

function draining_reason(running: number, reason: string): string {
	return `Start nothing more and poll until the running children merge (running: ${String(running)}). Then report and finish — ${reason}`
}

function idle_expired_reason(idle_budget_ms: number): string {
	return `The backlog stayed empty for the whole ${to_minutes(idle_budget_ms)}-minute idle watch. Report what was done, including how many were picked up during the watch, and finish.`
}

// Never longer than the watch has left: "about 2 minutes left, ask again in 5 minutes" would overrun
// the budget a person declared, and a sentence that contradicts itself is read as neither half.
function next_ask_minutes(left_ms: number): string {
	const left_minutes = Number(to_minutes(left_ms))

	return String(Math.min(IDLE_POLL_MINUTES, left_minutes))
}

function idle_watch_reason(left_ms: number): string {
	return `The backlog is empty and the idle watch has about ${to_minutes(left_ms)} minutes left. Release the working tree, ask again in ${next_ask_minutes(left_ms)} minutes, and restart the watch the moment a candidate appears.`
}

// **A watch that opens while children are still in lanes is not the idle watch's ordinary shape**, and
// it became reachable the moment the watch was turned on by default (joshuafolkken/kit#1676): the
// backlog can answer `exhausted` while this run's own children are still merging. Two things the
// sentence above would get wrong there — the working tree is still held, because the hold is released
// at the *last* child's merge, and a five-minute poll would leave a merge unnoticed for five minutes.
//
// **The watch runs down while they drain, and the sentence does not promise otherwise.** Pausing it
// would mean moving `active_at` on an ask that answered `exhausted`, which is the one thing that
// moment is defined not to do — so a drain longer than the budget ends the run at the drain. That is
// the honest ending: the backlog was empty at every ask, which is exactly what the watch measures.
function running_watch_reason(running: number, left_ms: number): string {
	return `The backlog is empty and the idle watch has about ${to_minutes(left_ms)} minutes left, with ${String(running)} still running. Keep the working tree until they merge and poll at the polling interval, not the idle poll — the watch is running down meanwhile.`
}

function watching_reason(input: BudgetInput, left_ms: number): string {
	if (input.running === 0) return idle_watch_reason(left_ms)

	return running_watch_reason(input.running, left_ms)
}

// What the maximum has already taken: merged issues and the children still running. Counting only
// the merged ones would let a second wave start before the first had merged and take the run past
// the maximum a person declared.
function taken_by(input: BudgetInput): number {
	return input.merged + input.running
}

function run_reason(input: BudgetInput): string {
	const { max_issues } = input

	if (max_issues === undefined) return 'No maximum was given, so start every issue offered.'

	return `Start at most ${String(max_issues - taken_by(input))} more: this run's maximum is ${String(max_issues)}, with ${String(input.merged)} merged and ${String(input.running)} running.`
}

// The two answers that end a run whatever the budgets say. Neither is a budget decision — the graph
// said so — but both reach this command, because the loop asks one question rather than branching on
// `backlog:next`'s word itself and then asking a second.
const ANSWER_STOP_REASONS: Readonly<Partial<Record<BacklogAnswer, string>>> = {
	parked: PARKED_REASON,
	unreadable: UNREADABLE_REASON,
}

function whole_run_reason(input: BudgetInput): string | undefined {
	if (input.now_ms - input.started_at_ms < WHOLE_RUN_BUDGET_MS) return undefined

	return WHOLE_RUN_REASON
}

// The answer-level stops come first, ahead of every budget. Both of them say something the person
// has to act on — issues are parked, or the listing could not be read — and the reason printed here
// is quoted verbatim into the completion report, so a budget reason in front of one would report a
// tidy ending for a run whose backlog actually broke.
function stop_reason(input: BudgetInput): string | undefined {
	return ANSWER_STOP_REASONS[input.answer] ?? whole_run_reason(input)
}

// Every ending goes through here, so no ending abandons a lane. Children already started have to
// merge and be reported whatever ended the run — the maximum, a parked backlog, a listing that could
// not be read, or the whole-run bound — so a `stop` while any of them is still running would leave
// open lanes behind and merged work unmentioned.
function stopping(input: BudgetInput, reason: string): BudgetDecision {
	if (input.running === 0) return { verdict: STOP_VERDICT, reason }

	return { verdict: WATCH_VERDICT, reason: draining_reason(input.running, reason) }
}

// The maximum is checked before the answer, so reaching it ends the run whatever `backlog:next` was
// about to offer. The acceptance criterion is that reaching it reports and finishes, and a run that
// first finished the wave it had already started would report a number the person never approved.
function max_decision(input: BudgetInput): BudgetDecision | undefined {
	const { max_issues } = input

	if (max_issues === undefined || taken_by(input) < max_issues) return undefined

	return stopping(input, max_reached_reason(input.merged, max_issues))
}

// An empty backlog is watched rather than acted on, which is now the default — and the watch lives
// *inside* the whole-run bound, which `stop_reason` has already applied above. Only `--idle 0` takes
// the other branch, where an empty backlog is the run's ending.
function idle_decision(input: BudgetInput): BudgetDecision {
	const { idle_budget_ms } = input

	if (idle_budget_ms === undefined) return stopping(input, NO_IDLE_WATCH_REASON)

	const left_ms = idle_budget_ms - (input.now_ms - input.active_at_ms)

	if (left_ms <= 0) return stopping(input, idle_expired_reason(idle_budget_ms))

	return { verdict: WATCH_VERDICT, reason: watching_reason(input, left_ms) }
}

function decide(input: BudgetInput): BudgetDecision {
	const reason = stop_reason(input)

	if (reason !== undefined) return stopping(input, reason)

	const capped = max_decision(input)

	if (capped !== undefined) return capped
	if (input.answer === 'candidates') return { verdict: RUN_VERDICT, reason: run_reason(input) }
	if (input.answer === 'blocked') return { verdict: WATCH_VERDICT, reason: BLOCKED_REASON }

	return idle_decision(input)
}

const backlog_budget = {
	ANSWERS,
	ANSWER_STOP_REASONS,
	BLOCKED_REASON,
	DEFAULT_IDLE_MINUTES,
	DEFAULT_IDLE_MS,
	IDLE_POLL_MINUTES,
	MS_PER_MINUTE,
	NO_IDLE_WATCH_REASON,
	PARKED_REASON,
	RUN_VERDICT,
	STOP_VERDICT,
	UNREADABLE_REASON,
	WATCH_VERDICT,
	WHOLE_RUN_BUDGET_HOURS,
	WHOLE_RUN_BUDGET_MINUTES,
	WHOLE_RUN_BUDGET_MS,
	WHOLE_RUN_REASON,
	decide,
	draining_reason,
	idle_expired_reason,
	idle_watch_reason,
	max_reached_reason,
	run_reason,
	running_watch_reason,
	taken_by,
}

export { backlog_budget }
export type { BacklogAnswer, BudgetDecision, BudgetInput, BudgetVerdict }
