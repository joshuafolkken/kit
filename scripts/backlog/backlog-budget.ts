// `josh backlog:budget` — whether a `backlogrun` may start more work, keep watching, or finish.
//
// `backlog:next` says what may start; it says nothing about when the run itself should end. Without
// this a run would finish the moment nothing could proceed, so an issue a person opted in minutes
// later would need a whole new session.
//
// **The idle watch is on by default and the maximum is not.** A `backlogrun` with neither flag given
// watches for `IDLE_WAIT_HOURS` once nothing can proceed before it finishes, and takes as many issues
// as the backlog holds. `--idle 0` is how the watch is turned off.
//
// **Every reason nothing can proceed is watched, not only an empty backlog.** Everything opted in
// waiting on a person, and a listing that could not be read, both change without this run doing
// anything — a person opts the prerequisite in, GitHub answers again — so ending on either would miss
// the issue opted in minutes later, which is the one thing the watch exists to catch.
//
// The decision is a command's rather than the loop's own arithmetic, for the reason `josh delegate`
// and `josh review:level` are commands: a count and an elapsed time kept in an agent's head are a
// one-shot judgement — a threshold asked once and then never again while the run walks past it.

const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60

// **How long a run with nothing to do waits, and the only time bound a run has.** It is counted from
// when the run last had work, never from its start: a run still working, or still inside this wait,
// is not ended by its age. Eight hours is one unattended night — a person who opts an issue in before
// they sleep, or after they wake, finds the run still there to pick it up.
const IDLE_WAIT_HOURS = 8
const DEFAULT_IDLE_MINUTES = IDLE_WAIT_HOURS * MINUTES_PER_HOUR
const DEFAULT_IDLE_MS = DEFAULT_IDLE_MINUTES * MS_PER_MINUTE

// **What a watching run sleeps between asks, and it is not the loop's 60-second polling interval.**
// That one is sized to a child's `fullrun`, which finishes in minutes; a watch is waiting on a person
// to file an issue and opt it in, which happens on human timescales. Polling a watch every minute
// would spend the parent session's own requests — each one billing the whole session history — to
// learn nothing each time. `backlogrun-progress.md` → "Waiting, and never waiting forever" holds
// the row; the figure is here because `idle_watch_reason` below has to say it.
const IDLE_POLL_MINUTES = 5

const RUN_VERDICT = 'run'
const WATCH_VERDICT = 'watch'
const STOP_VERDICT = 'stop'
const TRIAGE_VERDICT = 'triage'

// `run` — start what `backlog:next` offered. `watch` — sleep the polling interval and ask again,
// except while something of the run's own is in flight, where the wake is the progress watcher's exit
// and the interval is only a floor (`docs/maintainers/backlogrun-driver.md` → "Waiting while
// something is in flight").
// `stop` — report and finish. `triage` — judge the untriaged issues `backlog:next` named, then ask
// again; it is the parent's to act on, so `backlog:drive` hands it back.
type BudgetVerdict =
	typeof RUN_VERDICT | typeof WATCH_VERDICT | typeof STOP_VERDICT | typeof TRIAGE_VERDICT

// What `backlog:next` answered, in the words this decision needs. The mapping is mechanical and is
// written once, in `docs/josh-commands-backlog.md` → "`josh backlog:offer`": numbers are `candidates`, `wait` is `blocked` while
// this run has children in flight and `exhausted` when it does not, `none` is `exhausted`, `stop` is
// `parked`, `triage` is `untriaged`, and `error` or a failed listing is `unreadable`.
const ANSWERS = ['blocked', 'candidates', 'exhausted', 'parked', 'unreadable', 'untriaged'] as const

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
	// When this run last had work — its most recent launch or collected child, or the run's start.
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

const BLOCKED_REASON =
	'Everything opted in is blocked or already running, so waiting can still change the answer. Poll again at the polling interval.'

const TRIAGE_REASON =
	'An opted-in candidate carries neither `run:solo` nor `run:lane`, so nothing starts until it is judged. Read each issue named above, record its order and one of the two labels with a comment, then ask again.'

// What the run is waiting on, by the answer that opened the watch — the opening of every sentence a
// watch or its ending prints, so a person reads which of the three it was.
const EMPTY_BACKLOG = 'The backlog is empty'
const WAITING_ON: Readonly<Partial<Record<BacklogAnswer, string>>> = {
	exhausted: EMPTY_BACKLOG,
	parked: 'Nothing opted in can proceed without a person',
	unreadable: 'The backlog listing could not be read',
}

function waiting_on(answer: BacklogAnswer): string {
	return WAITING_ON[answer] ?? EMPTY_BACKLOG
}

function no_idle_watch_reason(answer: BacklogAnswer): string {
	return `${waiting_on(answer)} and the idle watch was turned off with \`--idle 0\`, so the run finishes here.`
}

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

function idle_expired_reason(answer: BacklogAnswer, idle_budget_ms: number): string {
	return `${waiting_on(answer)}, and stayed so for the whole ${to_minutes(idle_budget_ms)}-minute idle watch. Report what was done, including how many were picked up during the watch, and finish.`
}

// Never longer than the watch has left: "about 2 minutes left, ask again in 5 minutes" would overrun
// the budget a person declared, and a sentence that contradicts itself is read as neither half.
function next_ask_minutes(left_ms: number): string {
	const left_minutes = Number(to_minutes(left_ms))

	return String(Math.min(IDLE_POLL_MINUTES, left_minutes))
}

function idle_watch_reason(answer: BacklogAnswer, left_ms: number): string {
	return `${waiting_on(answer)} and the idle watch has about ${to_minutes(left_ms)} minutes left. Release the working tree, ask again in ${next_ask_minutes(left_ms)} minutes, and restart the watch the moment a candidate appears.`
}

// **A watch that opens while children are still in lanes is not the idle watch's ordinary shape**: the
// backlog can offer nothing while this run's own children are still merging. Two things the sentence
// above would get wrong there — the working tree is still held, because the hold is released at the
// *last* child's merge, and a five-minute poll would leave a merge unnoticed for five minutes.
//
// **The watch runs down while they drain, and restarts at each one collected.** A collected child is
// work, so it moves `active_at`; an ask that offered nothing never does.
function running_watch_reason(answer: BacklogAnswer, running: number, left_ms: number): string {
	return `${waiting_on(answer)} and the idle watch has about ${to_minutes(left_ms)} minutes left, with ${String(running)} still running. Keep the working tree until they merge and poll at the polling interval, not the idle poll — the watch is running down meanwhile.`
}

function watching_reason(input: BudgetInput, left_ms: number): string {
	if (input.running === 0) return idle_watch_reason(input.answer, left_ms)

	return running_watch_reason(input.answer, input.running, left_ms)
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

// Every ending goes through here, so no ending abandons a lane. Children already started have to
// merge and be reported whatever ended the run — the maximum, or a watch that ran out or was turned
// off — so a `stop` while any of them is still running would leave open lanes behind and merged work
// unmentioned.
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

// Nothing can proceed, so the run watches rather than ends — whichever of the three answers said so.
// The watch is the run's only time bound: it is counted from `active_at_ms`, so a run is never ended
// by how long ago it started. Only `--idle 0` takes the other branch, where the first such answer is
// the run's ending.
function idle_decision(input: BudgetInput): BudgetDecision {
	const { idle_budget_ms } = input

	if (idle_budget_ms === undefined) return stopping(input, no_idle_watch_reason(input.answer))

	const left_ms = idle_budget_ms - (input.now_ms - input.active_at_ms)

	if (left_ms > 0) return { verdict: WATCH_VERDICT, reason: watching_reason(input, left_ms) }

	return stopping(input, idle_expired_reason(input.answer, idle_budget_ms))
}

// Whether a `stop` for this input is the run finishing — the watch ending on an empty backlog —
// rather than stopping on something a person must act on: the maximum, issues still waiting on a
// person, or a listing that never became readable. The two end the carry record differently (`--end`
// against `--end --stopped`), and `backlog:drive` reads which one from here.
function is_finish(input: BudgetInput): boolean {
	return input.answer === 'exhausted' && max_decision(input) === undefined
}

// The answers whose decision no count changes, once the maximum above has been applied.
const FIXED_DECISIONS: Readonly<Partial<Record<BacklogAnswer, BudgetDecision>>> = {
	blocked: { verdict: WATCH_VERDICT, reason: BLOCKED_REASON },
	untriaged: { verdict: TRIAGE_VERDICT, reason: TRIAGE_REASON },
}

function answer_decision(input: BudgetInput): BudgetDecision {
	if (input.answer === 'candidates') return { verdict: RUN_VERDICT, reason: run_reason(input) }

	return FIXED_DECISIONS[input.answer] ?? idle_decision(input)
}

function decide(input: BudgetInput): BudgetDecision {
	return max_decision(input) ?? answer_decision(input)
}

const backlog_budget = {
	ANSWERS,
	BLOCKED_REASON,
	DEFAULT_IDLE_MINUTES,
	DEFAULT_IDLE_MS,
	IDLE_POLL_MINUTES,
	IDLE_WAIT_HOURS,
	MS_PER_MINUTE,
	RUN_VERDICT,
	STOP_VERDICT,
	TRIAGE_REASON,
	TRIAGE_VERDICT,
	WAITING_ON,
	WATCH_VERDICT,
	decide,
	draining_reason,
	idle_expired_reason,
	idle_watch_reason,
	is_finish,
	max_reached_reason,
	no_idle_watch_reason,
	run_reason,
	running_watch_reason,
	taken_by,
}

export { backlog_budget }
export type { BacklogAnswer, BudgetDecision, BudgetInput, BudgetVerdict }
