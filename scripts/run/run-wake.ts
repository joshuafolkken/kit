import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { stamp_file } from '#scripts/josh/stamp-file'
import { z } from 'zod'
import type { CarryRead } from './run-carry'

// joshuafolkken/kit#1719. joshuafolkken/kit#1714 made a `backlogrun`'s budget survive the session cut
// and left out the one thing that starts the next session, so the record was carried and the
// keystroke stayed: a cut still ended with a `confirmation` Telegram and a resume line, and a run
// measured to cut about every 50 minutes did nothing at all until a person came back to it. Overnight
// that is the whole night.
//
// This is that starter — a process outside the conversation, which the cut does not end.
//
// **Whether to wake is the record's answer, never a judgement.** `carried` *and* handed off is the one
// state that wakes; `none`, `expired` and `unreadable` stop the supervisor. So the 8-hour whole-run
// bound needs no check of its own here: it **is** the carry record's expiry, so a run past it reads
// `expired` and the supervisor stops (`run-carry.ts` → `CARRY_MAX_AGE_MS`, itself imported from
// `backlog-budget.ts` rather than restated). A bound re-derived here is one that drifts, and it drifts
// silently in the direction that matters — the supervisor would go on waking past a budget the record
// already calls spent.
//
// **A hand-off is what separates a cut from a session that is simply working.** `is_handed_off` is set
// by `run:carry --cut`, and by this supervisor only when it recovers a record whose owner has *died*
// (`run-wake-handoff.ts`, joshuafolkken/kit#2437) — so a live session's record never reads as waiting to
// be woken, and a crash is carried on as if the dead session had cut rather than left standing.
//
// **The supervisor never declares itself the record's owner, and that is the load-bearing decision.**
// joshuafolkken/kit#1722's hand-over note asks a machine-driven caller to always pass the owner
// declaration, because the half that refuses an interruption of a live run is opt-in. Read literally
// that would have this process name itself, and doing so would break the very thing it exists for:
// the owner is meant to be the process *spending the budget*, and here that is the session the
// supervisor wakes, not the supervisor. Named as owner, this long-lived process would still be alive
// when the woken session ran `run:carry --begin`, which `is_foreign_live_owner` answers `busy` — and
// the run would never resume. So the supervisor **reads** the carry record and never claims it, and
// the woken session claims it with `--owner "$PPID"` as `backlogrun.md` already requires; inside an
// agent session that names the long-lived agent process, which is the structure the same note asks to
// be confirmed when the waking side's process layout is decided.

const WAKE_PREFIX = 'josh-run-wake-'
// **Where the output of everything this supervisor starts is kept** (joshuafolkken/kit#1746).
// `detached` is what puts a child outside the conversation; discarding its output was a second choice
// riding along with it, and the two are separate requirements. Discarded, a session that exits without
// claiming the carry record leaves nothing at all to diagnose it by — which is the state
// joshuafolkken/kit#1746 was filed from, where three sessions died silently and the record could say
// only that none of them had arrived.
//
// One file per repository, appended to, so every attempt of every cut is in one place; keyed exactly
// as the wake and carry records are, so the three are found together. `.log` rather than `.json`
// because it holds another process's output verbatim — the distinction `stamp_file.stamp_path`'s
// `suffix` argument exists for.
const WAKE_LOG_PREFIX = 'josh-run-wake-log-'
const WAKE_LOG_SUFFIX = '.log'
// How long a woken session has to claim the carry record before that wake is treated as lost.
//
// **The window is measured from the spawn, so it has to cover everything before the session's first
// `run:carry --begin`** — the agent CLI's cold start, the resident preamble, and reading `SKILL.md`,
// `backlogrun.md`, `backlogrun.md` and the `fullrun` set. Ten minutes is several times the observed cost
// of that and still far inside the roughly 50-minute cut interval this exists to bridge. It was two
// minutes first, which is inside the range a merely *slow* start occupies — and a slow start booked as
// a failure ends the whole overnight run.
//
// **This one window is the only launch-failure detector, deliberately.** Reading the spawned process's
// exit code would catch a missing binary and miss the two failures that actually recur — a session
// that starts and dies during boot, and one that runs but never picks the run up. Asking instead
// whether the record was claimed catches all three, because it tests the thing that was wanted rather
// than the thing that was easy to observe.
const WAKE_GRACE_MS = 600_000
// **A lost wake is retried before it is called a failure**, because stopping is the expensive answer:
// it ends a run nobody is watching, for the night. Three attempts against a ten-minute window is
// half an hour of trying, which outlasts every transient cause worth surviving; past that the cause
// is not transient and a person has to see it.
const MAX_WAKE_ATTEMPTS = 3
// **How long a launch may be deferred for want of work before one is woken anyway**
// (joshuafolkken/kit#2417). A run whose backlog stays empty still needs one session to finish it — the
// drain, the retrospective and `run:carry --end` are a session's to do, not this process's — so a
// deferral without a ceiling would leave the record carried until its 8-hour expiry and end on a
// warning instead of a report. The ceiling is the `backlogrun` idle watch's own default, imported
// rather than restated: the supervisor watches the empty backlog for exactly as long as a woken session
// would have, only without paying a session to do it.
const IDLE_CEILING_MS = backlog_budget.DEFAULT_IDLE_MS
const NO_WAKES = 0
const ONE_WAKE = 1

// The supervisor's own record: which invocation it is watching, which process it is, and how many
// times it has woken a session.
interface RunWake {
	// Copied from the carry record at `--start`, so the two cannot disagree about what is being
	// continued. It is what the woken session is handed as its prompt.
	invocation: string
	profile?: AgentProfile | undefined
	started_at: string
	// The supervisor process. Unlike `run-hold.ts`, which records a pid it explicitly never reads back,
	// this one is read: `--list` reports whether the supervisor is still running and `--stop` needs
	// something to signal. The start-time token is what tells a reissued pid from the original.
	pid: number
	process_start?: string | undefined
	// Criterion: the number of wakes tracks the carry record's `cuts`. Counting them here is what makes
	// that checkable rather than merely argued from the structure. **It counts cuts served, not
	// launches**, so a retry of the same cut does not inflate it — `attempts` is what counts those.
	//
	// **A recovery is a wake without a cut, so `woke` may run ahead of `cuts`** (joshuafolkken/kit#2336).
	// When a session claims the record and then dies without cutting, the supervisor re-wakes and the
	// replacement's claim is counted here too — so `woke == cuts` becomes `woke >= cuts`, the gap being
	// the recoveries whose replacement claim a poll observed. `woke < cuts` still means a cut went
	// unserved, and `outstanding_line` remains the authoritative signal of a launch not yet claimed.
	//
	// **A cut is served when the woken session claims the carry record, not when a process starts**
	// (joshuafolkken/kit#1746). Counted at the spawn, the number asserted the very thing the supervisor
	// had not yet checked: on 2026-09-10 three sessions were launched for one cut and none of them ever
	// claimed the record, while `--list` went on reporting `woke 1 session(s) across 1 cut(s)` for forty
	// minutes — the published invariant reading as held throughout the failure it exists to expose. So
	// the increment moved to the one pass that observes a claim, and a wake nobody claimed now leaves
	// `woke` behind `cuts`, which is what the invariant was always meant to say.
	//
	// **It is observed at a poll, so it lags a claim by up to one polling interval** — a minute by
	// default. A shortfall read within that window is a claim not yet seen rather than one that never
	// happened, and the two are told apart by `attempts`: a cut still being retried has launches
	// outstanding, and one already claimed has none.
	woke: number
	// When the last wake happened, cleared as soon as the woken session claims the carry record. Its
	// presence is what the grace window above is measured from.
	woke_at?: string | undefined
	// Launches for the cut currently being served, reset when a session claims the record. Separate
	// from `woke` so a retried cut still reports as one wake against one cut — and, since
	// joshuafolkken/kit#1746, so the two say different things: this counts what was started and `woke`
	// counts what arrived, which is the gap a silent failure lives in.
	attempts?: number | undefined
	// The process the last launch produced. It is named in the failure warning rather than killed: a
	// session that is merely slow is still doing the run's work, and a supervisor that killed what it
	// could not account for would destroy exactly the work it exists to keep going.
	woke_pid?: number | undefined
	// When the wait on a still-running predecessor began. **It is its own field rather than a second
	// use of `woke_at`, and that is the whole of the bound working as described.** Marked on `woke_at`,
	// the first pass of a wait was the last one that could see the predecessor exit — every later pass
	// read the mark as an outstanding wake and answered `pending` — so a predecessor that ended two
	// seconds after the hold still cost the full grace window on a supervisor whose point is not to
	// stall. Kept apart, the predecessor's liveness is read on every pass and the mark only bounds how
	// long the wait may last.
	held_at?: string | undefined
	// The transcript ids of every session this supervisor forced with `--session-id`
	// (joshuafolkken/kit#2407). `josh time --run` attributes a whiff only to a session in this list, so
	// an unrelated read-only session that moved while the supervisor was alive is no longer counted
	// against the wake role — the $7.68 the Issue read as a ceiling becomes the real figure. Appended
	// once per launch, retries included, since each retry is a real session that woke and may have done
	// nothing, and carried across a supervisor restart exactly like the counters beside it.
	spawned?: ReadonlyArray<string> | undefined
	// When the supervisor first deferred a launch because there was no work (joshuafolkken/kit#2417).
	// Marked once and cleared by the next launch or claim, so it measures one unbroken idle stretch: it
	// bounds the deferral at `IDLE_CEILING_MS`, and `run-wake-loop.ts` stretches the polling interval
	// by it, which is the back-off after repeated whiffs.
	idle_since?: string | undefined
}

type WakeStopReason = 'ended' | 'expired' | 'unreadable' | 'failed' | 'stopped'

// What the loop's tidy-up found at its own target (joshuafolkken/kit#1727). `absent` is the ordinary
// `--stop`, `removed` the ordinary end of a loop, and `superseded` the one that has to be said out
// loud: another supervisor holds the record and this process is the replaced one.
type WakeTidyResult = 'absent' | 'removed' | 'superseded'

// `wait` and `pending` are two states rather than one because the wake mark is cleared in the first
// and must survive the second — collapsed into one answer, a supervisor inside its grace window would
// forget it had already woken and wake again every interval. `idle` is a launch the record called for
// and the work did not: nothing is started, and the stretch is marked so it can be bounded.
type WakeDecision =
	| { kind: 'wake' }
	| { kind: 'idle' }
	| { kind: 'wait' }
	| { kind: 'pending' }
	| { kind: 'hold' }
	| { kind: 'failed' }
	| { kind: 'stop'; reason: WakeStopReason }

interface WakeDecisionInput {
	read: CarryRead
	woke_at: string | undefined
	attempts: number
	// Whether the process named on the carry record is still running. **A cut is the run's last write,
	// not the moment its process is gone** — so a supervisor that woke the instant it saw the hand-off
	// could have the new session answered `busy`, because `run-carry.ts` → `classify_claim` tests
	// `is_foreign_live_owner` before it tests the hand-off. Answered `busy`, the woken session stops
	// without claiming anything, and the supervisor would eventually call its own wake a failure and end
	// the run. So the predecessor is waited out first.
	is_owner_live: boolean
	// When the wait on that predecessor began, so the wait can be bounded without spending the mark
	// that measures a launch.
	held_at: string | undefined
	// **Whether a woken session would find anything to do** (joshuafolkken/kit#2417). Before this the
	// decision read the carry record alone, so a session was launched whether or not the backlog held a
	// runnable issue or a lane was free — and a session that found nothing ended without touching
	// anything, which is the whiff. `undefined` is "cannot tell", and it wakes: a failed read is not an
	// empty backlog, and the error that costs a whiff is cheaper than the one that stalls the run.
	// Optional for that reason: an input that does not say reads exactly as the record-only decision did.
	has_work?: boolean | undefined
	// When the current idle stretch began, so the deferral can be bounded.
	idle_since?: string | undefined
	now: Date
}

const WAKE_DECISION: WakeDecision = { kind: 'wake' }
const IDLE_DECISION: WakeDecision = { kind: 'idle' }
const WAIT_DECISION: WakeDecision = { kind: 'wait' }
const PENDING_DECISION: WakeDecision = { kind: 'pending' }
const HOLD_DECISION: WakeDecision = { kind: 'hold' }
const FAILED_DECISION: WakeDecision = { kind: 'failed' }

// The three carry reads that are not `carried`, each mapped to why the supervisor stops. `none` is the
// run having ended normally (`run:carry --end`); `expired` is the whole-run bound; `unreadable` is a
// record that cannot be trusted to say anything, which is a reason to stop rather than to guess.
const STOP_REASONS: Record<'none' | 'expired' | 'unreadable', WakeStopReason> = {
	none: 'ended',
	expired: 'expired',
	unreadable: 'unreadable',
}

const run_wake_schema = z.object({
	invocation: z.string(),
	started_at: z.string(),
	pid: z.number(),
	process_start: z.string().optional(),
	woke: z.number(),
	woke_at: z.string().optional(),
	// **Every optional field of `RunWake` has to be listed here.** `z.object` strips what it does not
	// declare, so a field added to the interface alone round-trips through disk as `undefined` — which
	// reads as "no attempt has been made yet" and would restart the retry count on every pass.
	attempts: z.number().optional(),
	woke_pid: z.number().optional(),
	held_at: z.string().optional(),
	spawned: z.array(z.string()).optional(),
	idle_since: z.string().optional(),
	profile: agent_role_profile.PROFILE_SCHEMA.optional(),
})

// An unparsable stamp reads as overdue rather than as fresh: a mark whose time cannot be established
// is one that cannot be confirmed to have worked, and the safe direction is to report the failure.
function is_overdue(marked_at: string, now: Date, limit_ms: number = WAKE_GRACE_MS): boolean {
	const marked = Date.parse(marked_at)

	if (Number.isNaN(marked)) return true

	return now.getTime() - marked > limit_ms
}

// **A launch goes out only where there is work, or where the idle stretch has run past its ceiling**
// (joshuafolkken/kit#2417). This is the one gate every launch passes — the first wake of a cut, the
// recovery of a dead owner and a retry alike — because a retry into an empty backlog is the same whiff
// as a first wake into one. Past the ceiling the session is woken anyway, to finish the run.
function launch_or_idle(input: WakeDecisionInput): WakeDecision {
	if (input.has_work !== false) return WAKE_DECISION
	if (input.idle_since === undefined) return IDLE_DECISION

	return is_overdue(input.idle_since, input.now, IDLE_CEILING_MS) ? WAKE_DECISION : IDLE_DECISION
}

// **Whether to launch, pend, retry or give up, read from the wake mark alone.** It is reached from two
// places — a record a cut handed off whose predecessor has gone, and a record no cut handed off whose
// owner has *died* (the recovery below) — because both ask the same question once the decision to press
// on has been made: is a wake already out, is it still inside its grace window, and are there retries
// left. `woke_at === undefined` is "nothing outstanding, launch"; inside the window is `pending`; past
// it, a retry while attempts remain and otherwise `failed`.
function decide_launch(input: WakeDecisionInput): WakeDecision {
	if (input.woke_at === undefined) return launch_or_idle(input)
	if (!is_overdue(input.woke_at, input.now)) return PENDING_DECISION

	return input.attempts < MAX_WAKE_ATTEMPTS ? launch_or_idle(input) : FAILED_DECISION
}

// **A record no cut handed off is one of two things, told apart by the owner's liveness**
// (joshuafolkken/kit#2336). A *live* owner is a session spending the budget — the ordinary in-flight
// state, and there is nothing to do but wait. A *dead* owner is the defect this branch exists for: a
// session that claimed the record and then exited without cutting or ending — a woken session that
// crashed during boot, reported its state and stopped, or was ended by a stray notification — leaves
// the record `carried`, owned by a gone process, with no hand-off. Before this the supervisor answered
// `wait` to both and so waited on the dead one until the 8-hour bound, stopping the whole run in
// silence. Now a dead owner is recovered through the same grace/retry machinery a hand-off uses, so a
// crash between the claim and the next cut re-wakes rather than stranding the invocation.
//
// **`is_owner_live` is `!== false`, so "cannot tell" counts as living** (`run-carry.ts` →
// `is_owner_live`): a liveness read that cannot prove death keeps the safe answer, `wait`, and never
// double-wakes a session that is merely unreadable.
function decide_not_handed_off(input: WakeDecisionInput): WakeDecision {
	if (input.is_owner_live) return WAIT_DECISION

	return decide_launch(input)
}

// Only before the first launch for this cut. Once a wake is out, the record's owner is whatever the
// woken session declares, and waiting on it again would stall the grace window indefinitely.
//
// **The wait is bounded, and the bound is not decoration.** The owner is the agent process of the
// session that cut, and an interactive one often outlives its own cut — waited on without a bound, the
// supervisor would pend every interval for the record's whole life, wake nothing, and end on `expired`,
// which sends no warning. That is a silent overnight failure, which is worse than the `busy` race this
// wait exists to avoid: a `busy` merely costs one attempt, and attempts are retried. So the wait is
// marked when it starts and expires into an ordinary wake through the same grace window everything
// else uses.
//
// **And the wait ends the moment the predecessor does, because its liveness is read on every pass.**
// The bound is the ceiling on the wait, never its length: a predecessor that exits two seconds after
// the hold is waited two seconds. That is what `held_at` is a separate field for — marked on `woke_at`,
// this test could not fire a second time, so every wait cost the whole ceiling.
function is_predecessor_exiting(input: WakeDecisionInput): boolean {
	if (input.woke_at !== undefined || !input.is_owner_live) return false

	return input.held_at === undefined || !is_overdue(input.held_at, input.now)
}

// The whole policy, in four lines. Nothing else in this module decides whether to wake.
function decide(input: WakeDecisionInput): WakeDecision {
	if (input.read.kind !== 'carried') return { kind: 'stop', reason: STOP_REASONS[input.read.kind] }
	if (input.read.carry.is_handed_off !== true) return decide_not_handed_off(input)
	if (is_predecessor_exiting(input)) return HOLD_DECISION

	return decide_launch(input)
}

// Keyed on the repository's common git directory, exactly as the carry record is — one supervisor per
// invocation, and every lane of that repository keys alike. `run_carry.repository_directory` is what
// resolves it, so the two records can never key differently.
function wake_path(git_directory: string): string {
	return stamp_file.stamp_path(WAKE_PREFIX, git_directory)
}

// Keyed on the same directory as the two records, so a person handed one path can find the others.
function wake_log_path(git_directory: string): string {
	return stamp_file.stamp_path(WAKE_LOG_PREFIX, git_directory, WAKE_LOG_SUFFIX)
}

function parse_wake(raw: string): RunWake | undefined {
	try {
		return run_wake_schema.parse(JSON.parse(raw))
	} catch {
		return undefined
	}
}

function read_wake(target: string): RunWake | undefined {
	const raw = stamp_file.read_stamp_text(target)

	return raw === undefined ? undefined : parse_wake(raw)
}

function write_wake(target: string, wake: RunWake): void {
	stamp_file.write_stamp(target, wake)
}

function remove_wake(target: string): void {
	stamp_file.remove_stamp(target)
}

function fresh_wake(invocation: string, now: Date, profile?: AgentProfile): RunWake {
	return {
		invocation,
		...(profile && { profile }),
		started_at: now.toISOString(),
		woke: NO_WAKES,
		...process_identity.own_fields(),
	}
}

// **`!== false`, so "cannot tell" counts as running.** The two errors are not symmetric: a live
// supervisor read as dead means two supervisors waking two sessions into one budget, while a dead one
// read as live costs a refused `--start` the person can retry after `--stop`. This takes the second.
function is_supervisor_live(wake: RunWake): boolean {
	return process_identity.is_same_process(wake.pid, wake.process_start) !== false
}

// A restarted supervisor inherits the whole wake state rather than starting it over. `woke` is
// published against the carry record's `cuts` as an invariant, so a `--stop` / `--start` cycle mid-run
// that reset it would make `--list` under-report and the published check read as a defect that never
// happened. **`woke_at` and `attempts` come with it, and dropping them is not cosmetic**: a restart
// inside the grace window would otherwise see no wake mark, launch a second session for the *same*
// cut, count it as another cut served, and leave two sessions racing for one record. The invocation
// has to match — a different one is a different run, and its state is not this one's.
// **`woke_pid` and `held_at` come across too.** Without the first, a restart inside the grace window
// that then spends its retries reports "the last one was none" in the warning — the one fact the
// warning exists to hand the person, dropped exactly where it is needed. Without the second, a restart
// restarts the bounded wait, which is the ceiling sliding by another road.
function carried_state(existing: RunWake | undefined, invocation: string): Partial<RunWake> {
	if (existing?.invocation !== invocation) return { woke: NO_WAKES }

	return {
		woke: existing.woke,
		woke_at: existing.woke_at,
		attempts: existing.attempts,
		woke_pid: existing.woke_pid,
		held_at: existing.held_at,
		// **`spawned` carries across too, or a restart mid-run would lose the ids of every session it
		// already started** (joshuafolkken/kit#2407) — and `josh time --run`, reading the record after
		// the restart, would under-count the whiffs and read the loss as a saving.
		spawned: existing.spawned,
		// And `idle_since`, or a restart would slide the idle ceiling by the time already spent idle.
		idle_since: existing.idle_since,
		...(existing.profile && { profile: existing.profile }),
	}
}

function is_held_by_live_supervisor(existing: RunWake | undefined): boolean {
	return existing !== undefined && is_supervisor_live(existing)
}

// The second attempt, reached only because something was already at the target: the dead-marker sweep
// `unit-worker-share.ts` does for the unit-suite share, and then one more exclusive create. The record
// is re-read first, because between the two creates it may have become a live supervisor's.
function reclaim(target: string, wake: RunWake): RunWake | undefined {
	if (is_held_by_live_supervisor(read_wake(target))) return undefined

	remove_wake(target)

	return stamp_file.create_stamp(target, wake) ? wake : undefined
}

// `create_stamp` rather than `write_stamp`: two `--start`s racing must not both come away believing
// they own the record.
//
// **The create is attempted before anything is removed, and that ordering is the exclusion.** Sweeping
// first — which this did, unconditionally — gives the exclusive create nothing to exclude: two claims
// that both read an empty target would each delete what the other had just created, and both would
// then succeed, leaving two supervisors waking two sessions into one carry budget. Attempted first, the
// create is what decides between them, and the sweep runs only where it found something already there
// — including a stamp that could not be parsed at all, which is why the sweep is not simply dropped.
function claim(
	target: string,
	invocation: string,
	now: Date,
	profile?: AgentProfile,
): RunWake | undefined {
	const existing = read_wake(target)

	if (is_held_by_live_supervisor(existing)) return undefined

	const wake = { ...fresh_wake(invocation, now, profile), ...carried_state(existing, invocation) }

	return stamp_file.create_stamp(target, wake) ? wake : reclaim(target, wake)
}

// A launch marks the attempt and nothing else. `woke` is left alone here because a process that has
// started has not yet done the thing `woke` counts — `count_claim` is where that is decided.
//
// **The forced session id is recorded here, at the launch, because that is where it is known**
// (joshuafolkken/kit#2407). It is appended rather than replaced: a run spawns one session per cut plus
// one per retry, and `josh time --run` needs every id to tell a session it started from an unrelated
// one that merely moved while it was alive.
function count_wake(wake: RunWake, now: Date, pid: number, session_id: string): RunWake {
	const attempts = (wake.attempts ?? NO_WAKES) + ONE_WAKE
	const spawned = [...(wake.spawned ?? []), session_id]
	const woke_at = now.toISOString()

	return {
		...wake,
		attempts,
		spawned,
		woke_at,
		woke_pid: pid,
		held_at: undefined,
		idle_since: undefined,
	}
}

// Starts the clock on a wait without launching anything. `attempts` is deliberately untouched, so the
// bounded wait costs no retry: what it buys is that the wait expires into an ordinary wake instead of
// running until the carry record does.
//
// **Marked once, so the ceiling does not slide.** A mark rewritten on every pass would measure from the
// latest pass rather than from the start of the wait, and a predecessor that never exits would then be
// waited on for ever — the unbounded wait this bound exists to prevent, arrived at by another road.
function mark_wait(wake: RunWake, now: Date): RunWake {
	return wake.held_at === undefined ? { ...wake, held_at: now.toISOString() } : wake
}

// Starts the idle stretch a deferred launch is bounded by (joshuafolkken/kit#2417). Marked once, for
// the reason `mark_wait` is: rewritten each pass, the ceiling would slide and never be reached.
function mark_idle(wake: RunWake, now: Date): RunWake {
	return wake.idle_since === undefined ? { ...wake, idle_since: now.toISOString() } : wake
}

// **The one pass that observes a claim, and therefore the one place `woke` may grow**
// (joshuafolkken/kit#1746). The supervisor reaches it when the carry record stops reading as handed
// off, which `run-carry.ts` → `adopt_carry` does only from the session that took the record over — so
// the count is of records actually claimed rather than of processes started.
//
// **The mark is what says a wake was outstanding.** Without it this same state is an ordinary live
// session working through its budget, which no supervisor woke and which must not be counted; with
// it, the wake that was pending has just been answered.
//
// `undefined` rather than a deleted key, because `JSON.stringify` drops it on the way to disk and the
// reader treats absent and undefined alike — the same round-trip `run-carry.ts` documents for its own
// optional fields.
function count_claim(wake: RunWake): RunWake {
	const woke = wake.woke_at === undefined ? wake.woke : wake.woke + ONE_WAKE

	return {
		...wake,
		woke,
		woke_at: undefined,
		attempts: undefined,
		held_at: undefined,
		idle_since: undefined,
	}
}

// **Whether the record at the target is this process's own** (joshuafolkken/kit#1727). Everything
// below that decides a write or a removal asks this rather than asking whether a record is there.
//
// **Existence was standing in for ownership, and the two come apart exactly when it matters.** A
// `--stop` that removes the record but does not reach the process — `EPERM`, or a liveness read that
// calls a running process dead — followed by a person's `--start` leaves the old loop awake beside a
// new supervisor's record. Asked only whether *a* record is there, the old loop writes its own pid
// and counters into the new one, and two supervisors then wake two sessions into one carry budget:
// the state `claim`'s exclusive create exists to prevent, reached after the create rather than
// through it. Asked whether the record is *its own*, it finds it is not and does nothing.
//
// **The precedent is `run-carry.ts` alone**, whose `is_owned_by` compares a record's `owner_pid` and
// `owner_start` against the owner the caller declares, and whose `is_foreign_live_owner` is that
// comparison deciding what a caller may touch. `run-hold.ts` is **not** a precedent and reading it as
// one is the mistake this note exists to prevent: it records a pid for the person reading the stop
// message and explicitly never reads it back (`run-hold.ts` → `describe_holder`), which is the
// distinction `RunWake.pid` above already draws.
//
// The one difference from `run-carry.ts` is who the owner is. There the owner is declared from
// outside, because the process spending the budget is not the one writing the record; here the writer
// *is* the owner, so the declaration is `process_identity.own_fields()` and the comparison is against
// this process.
function is_own_wake(wake: RunWake): boolean {
	return process_identity.is_own_process(wake.pid, wake.process_start)
}

// The record only where it is this process's own. It is what the loop reads at the top of each pass,
// so a supervisor whose record has been taken over ends **before** it decides anything — refusing the
// write-back alone would still have spawned a session for a run somebody else is already watching.
function read_own_wake(target: string): RunWake | undefined {
	const wake = read_wake(target)

	return wake !== undefined && is_own_wake(wake) ? wake : undefined
}

// **Removes only this process's own record.** `--stop` and the dead-marker sweep in `reclaim` keep
// using `remove_wake`, and that is deliberate: a person stopping the supervisor is removing someone
// else's record on purpose, and a sweep is removing a record whose writer is gone. What must not
// happen is the loop's own tidy-up taking a live successor's record with it, which leaves the run
// unwatched with nothing anywhere saying so.
//
// **Read-then-remove, so a take-over landing between the two still costs the successor its record.**
// The same residual window `update_wake` has, and closing it needs an exclusive operation the stamp
// layer does not offer. What this removes is the case that was certain — the loop ending after a
// take-over it had already noticed — rather than the one that needs the hand-over to land inside two
// statements.
//
// **Three answers rather than a boolean, because the caller has to tell two of them apart.** An
// ordinary `--stop` and a take-over both leave this process with nothing to remove, and only the
// second is worth saying anything about — a `false` covering both put the caller in the position of
// re-deriving which one it was from a second read, which is a branch that can be written the wrong
// way round and would then announce a supersession on every ordinary stop. Answered here, the
// distinction is decided once, in the place that already holds the record.
function tidy_own_wake(target: string): WakeTidyResult {
	const wake = read_wake(target)

	if (wake === undefined) return 'absent'
	if (!is_own_wake(wake)) return 'superseded'

	remove_wake(target)

	return 'removed'
}

// **Writes only where the record is still there *and* is this process's own.** `--stop` removes it,
// and the loop's pass is not instantaneous — it spawns a process — so an unconditional write-back can
// recreate a record a person has just deleted, leaving a supervisor that outlives its own stop; the
// presence check narrows that window rather than closing it outright, and what closes it is that the
// next pass reads the record again. The ownership check is the second half: a foreign record is
// never written back, however long the pass took.
//
// **That is a claim about the write and about nothing else.** A take-over landing mid-pass is still
// narrowed rather than closed — the pass spawns a process, so a session can go out for a cut the
// successor is also serving, and only the write-back that follows it is refused. What closes the
// window at the top of a pass is `read_own_wake`, and what closes it inside one is nothing here:
// this is a refusal to make the damage permanent, not a lock.
function update_wake(target: string, wake: RunWake): boolean {
	if (read_own_wake(target) === undefined) return false

	write_wake(target, wake)

	return true
}

const run_wake = {
	IDLE_CEILING_MS,
	MAX_WAKE_ATTEMPTS,
	WAKE_GRACE_MS,
	WAKE_PREFIX,
	claim,
	count_claim,
	count_wake,
	decide,
	fresh_wake,
	is_supervisor_live,
	mark_idle,
	mark_wait,
	parse_wake,
	read_own_wake,
	read_wake,
	remove_wake,
	tidy_own_wake,
	update_wake,
	wake_log_path,
	wake_path,
	write_wake,
}

export type { RunWake, WakeDecision, WakeDecisionInput, WakeStopReason, WakeTidyResult }
export { run_wake }
