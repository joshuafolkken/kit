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
// by `run:carry --cut` and by nothing else, so a live session's record never reads as waiting to be
// woken, and a crash — which never reaches `--cut` — is left to the person exactly as before.
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
// How long a woken session has to claim the carry record before that wake is treated as lost.
//
// **The window is measured from the spawn, so it has to cover everything before the session's first
// `run:carry --begin`** — the agent CLI's cold start, the resident preamble, and reading `SKILL.md`,
// `backlogrun.md`, `epicrun.md` and the `fullrun` set. Ten minutes is several times the observed cost
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
const NO_WAKES = 0
const ONE_WAKE = 1

// The supervisor's own record: which invocation it is watching, which process it is, and how many
// times it has woken a session.
interface RunWake {
	// Copied from the carry record at `--start`, so the two cannot disagree about what is being
	// continued. It is what the woken session is handed as its prompt.
	invocation: string
	started_at: string
	// The supervisor process. Unlike `run-hold.ts`, which records a pid it explicitly never reads back,
	// this one is read: `--list` reports whether the supervisor is still running and `--stop` needs
	// something to signal. The start-time token is what tells a reissued pid from the original.
	pid: number
	process_start?: string | undefined
	// Criterion: the number of wakes has to match the carry record's `cuts`. Counting them here is what
	// makes that checkable rather than merely argued from the structure. **It counts cuts served, not
	// launches**, so a retry of the same cut does not inflate it — `attempts` is what counts those.
	woke: number
	// When the last wake happened, cleared as soon as the woken session claims the carry record. Its
	// presence is what the grace window above is measured from.
	woke_at?: string | undefined
	// Launches for the cut currently being served, reset when a session claims the record. Separate
	// from `woke` so a retried cut still reports as one wake against one cut.
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
}

type WakeStopReason = 'ended' | 'expired' | 'unreadable' | 'failed' | 'stopped'

// What the loop's tidy-up found at its own target (joshuafolkken/kit#1727). `absent` is the ordinary
// `--stop`, `removed` the ordinary end of a loop, and `superseded` the one that has to be said out
// loud: another supervisor holds the record and this process is the replaced one.
type WakeTidyResult = 'absent' | 'removed' | 'superseded'

// `wait` and `pending` are two states rather than one because the wake mark is cleared in the first
// and must survive the second — collapsed into one answer, a supervisor inside its grace window would
// forget it had already woken and wake again every interval.
type WakeDecision =
	| { kind: 'wake' }
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
	now: Date
}

const WAKE_DECISION: WakeDecision = { kind: 'wake' }
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
})

// An unparsable stamp reads as overdue rather than as fresh: a mark whose time cannot be established
// is one that cannot be confirmed to have worked, and the safe direction is to report the failure.
function is_overdue(marked_at: string, now: Date): boolean {
	const marked = Date.parse(marked_at)

	if (Number.isNaN(marked)) return true

	return now.getTime() - marked > WAKE_GRACE_MS
}

function decide_handed_off(input: WakeDecisionInput): WakeDecision {
	if (input.woke_at === undefined) return WAKE_DECISION
	if (!is_overdue(input.woke_at, input.now)) return PENDING_DECISION

	return input.attempts < MAX_WAKE_ATTEMPTS ? WAKE_DECISION : FAILED_DECISION
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
	if (input.read.carry.is_handed_off !== true) return WAIT_DECISION
	if (is_predecessor_exiting(input)) return HOLD_DECISION

	return decide_handed_off(input)
}

// Keyed on the repository's common git directory, exactly as the carry record is — one supervisor per
// invocation, and every lane of that repository keys alike. `run_carry.repository_directory` is what
// resolves it, so the two records can never key differently.
function wake_path(git_directory: string): string {
	return stamp_file.stamp_path(WAKE_PREFIX, git_directory)
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

function fresh_wake(invocation: string, now: Date): RunWake {
	return {
		invocation,
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
function claim(target: string, invocation: string, now: Date): RunWake | undefined {
	const existing = read_wake(target)

	if (is_held_by_live_supervisor(existing)) return undefined

	const wake = { ...fresh_wake(invocation, now), ...carried_state(existing, invocation) }

	return stamp_file.create_stamp(target, wake) ? wake : reclaim(target, wake)
}

// `woke` counts cuts served and `attempts` counts launches, so a retry of the same cut leaves the
// published invariant alone.
function count_wake(wake: RunWake, now: Date, pid: number): RunWake {
	const attempts = (wake.attempts ?? NO_WAKES) + ONE_WAKE
	const woke = attempts === ONE_WAKE ? wake.woke + ONE_WAKE : wake.woke

	return { ...wake, woke, attempts, woke_at: now.toISOString(), woke_pid: pid, held_at: undefined }
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

// `undefined` rather than a deleted key, because `JSON.stringify` drops it on the way to disk and the
// reader treats absent and undefined alike — the same round-trip `run-carry.ts` documents for its own
// optional fields.
function clear_wake_mark(wake: RunWake): RunWake {
	return { ...wake, woke_at: undefined, attempts: undefined, held_at: undefined }
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
	MAX_WAKE_ATTEMPTS,
	WAKE_GRACE_MS,
	WAKE_PREFIX,
	claim,
	clear_wake_mark,
	count_wake,
	decide,
	fresh_wake,
	is_supervisor_live,
	mark_wait,
	parse_wake,
	read_own_wake,
	read_wake,
	remove_wake,
	tidy_own_wake,
	update_wake,
	wake_path,
	write_wake,
}

export type { RunWake, WakeDecision, WakeDecisionInput, WakeStopReason, WakeTidyResult }
export { run_wake }
