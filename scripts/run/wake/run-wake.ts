import { agent_role_profile, type AgentProfile } from '#scripts/agent/agent-role-profile'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { process_owner_schema } from '#scripts/josh/process-owner'
import { stamp_file } from '#scripts/josh/stamp-file'
import { json_value } from '#scripts/lib/json-value'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import { z } from 'zod'

// The process outside the conversation that starts the next session after a `backlogrun` cut.
// Whether to wake is the carry record's answer, never a judgement: `carried` and handed off wakes;
// `none`, `expired` (the whole-run bound) and `unreadable` stop. A hand-off is set by `run:carry --cut`,
// or by this supervisor when it recovers a record whose owner died, so a live session never reads as
// waiting. The supervisor owns the record while its deterministic driver spends the budget; a judgment
// branch hands it off so one AI session can adopt it.

const WAKE_PREFIX = 'josh-run-wake-'
// The output of every session this starts, appended per repository so a silent death is diagnosable.
const WAKE_LOG_PREFIX = 'josh-run-wake-log-'
const WAKE_LOG_SUFFIX = '.log'
// How long a woken session has to claim the carry record — the only launch-failure detector, since a
// claim also catches a session that dies in boot or never picks the run up. It covers a slow cold start.
const WAKE_GRACE_MS = 600_000
// Retried before failing: stopping ends a run nobody is watching.
const MAX_WAKE_ATTEMPTS = 3
// An empty backlog still needs one session to finish the run, so a deferral is bounded by the
// `backlogrun` idle watch's own default.
const IDLE_CEILING_MS = backlog_budget.DEFAULT_IDLE_MS
const NO_WAKES = 0
const ONE_WAKE = 1

interface RunWake {
	// Copied from the carry record at `--start`; it is the woken session's prompt.
	invocation: string
	profile?: AgentProfile | undefined
	started_at: string
	// Read back by `--list` and `--stop`; the start-time token tells a reissued pid from the original.
	pid: number
	process_start?: string | undefined
	// Cuts served, counted when a woken session claims the record (not at the spawn), so an unclaimed
	// wake leaves `woke` behind `cuts`. A dead-owner recovery is a wake without a cut, so `woke >= cuts`.
	// Observed at a poll, so it lags a claim by up to one interval.
	woke: number
	// The grace window is measured from this; cleared when the woken session claims the record.
	woke_at?: string | undefined
	// Launches for the current cut: what was started, against `woke`'s what arrived.
	attempts?: number | undefined
	// Named in the failure warning, never killed — a slow session is still doing the run's work.
	woke_pid?: number | undefined
	// Every `--session-id` this forced, so `josh time --run` attributes whiffs only to its own sessions.
	spawned?: ReadonlyArray<string> | undefined
	// Start of one unbroken idle stretch: bounds the deferral and backs off the polling interval.
	idle_since?: string | undefined
}

type WakeStopReason = 'ended' | 'expired' | 'unreadable' | 'failed' | 'stopped'

// `superseded`: another supervisor holds the record and this process is the replaced one.
type WakeTidyResult = 'absent' | 'removed' | 'superseded'

// `wait` clears the wake mark and `pending` keeps it, or a supervisor would re-wake every interval.
// `idle` is a launch the record called for and the work did not.
type WakeDecision =
	| { kind: 'wake' }
	| { kind: 'idle' }
	| { kind: 'wait' }
	| { kind: 'pending' }
	| { kind: 'failed' }
	| { kind: 'stop'; reason: WakeStopReason }

interface WakeDecisionInput {
	read: CarryRead
	woke_at: string | undefined
	attempts: number
	// Read only for a record no cut handed off; a handed-off record launches whether its cutter lives or not.
	is_owner_live: boolean
	// Whether a woken session would find work. `undefined` ("cannot tell") wakes: a whiff is cheaper
	// than a stalled run.
	has_work?: boolean | undefined
	idle_since?: string | undefined
	now: Date
}

const WAKE_DECISION: WakeDecision = { kind: 'wake' }
const IDLE_DECISION: WakeDecision = { kind: 'idle' }
const WAIT_DECISION: WakeDecision = { kind: 'wait' }
const PENDING_DECISION: WakeDecision = { kind: 'pending' }
const FAILED_DECISION: WakeDecision = { kind: 'failed' }

const STOP_REASONS: Record<'none' | 'expired' | 'unreadable', WakeStopReason> = {
	none: 'ended',
	expired: 'expired',
	unreadable: 'unreadable',
}

const run_wake_schema = process_owner_schema.extend({
	invocation: z.string(),
	started_at: z.string(),
	woke: z.number(),
	woke_at: z.string().optional(),
	// Every optional `RunWake` field must be listed: `z.object` strips undeclared ones on the round trip.
	attempts: z.number().optional(),
	woke_pid: z.number().optional(),
	spawned: z.array(z.string()).optional(),
	idle_since: z.string().optional(),
	profile: agent_role_profile.PROFILE_SCHEMA.optional(),
})

// An unparsable stamp is overdue: a mark that cannot be confirmed is reported as a failure.
function is_overdue(marked_at: string, now: Date, limit_ms: number = WAKE_GRACE_MS): boolean {
	const marked = Date.parse(marked_at)

	if (Number.isNaN(marked)) return true

	return now.getTime() - marked > limit_ms
}

// The one gate every launch (first wake, recovery, retry) passes: launch only where there is work, or
// once the idle stretch passes its ceiling.
function launch_or_idle(input: WakeDecisionInput): WakeDecision {
	if (input.has_work !== false) return WAKE_DECISION
	if (input.idle_since === undefined) return IDLE_DECISION

	return is_overdue(input.idle_since, input.now, IDLE_CEILING_MS) ? WAKE_DECISION : IDLE_DECISION
}

// Launch, pend, retry or give up, read from the wake mark alone.
function decide_launch(input: WakeDecisionInput): WakeDecision {
	if (input.woke_at === undefined) return launch_or_idle(input)
	if (!is_overdue(input.woke_at, input.now)) return PENDING_DECISION

	return input.attempts < MAX_WAKE_ATTEMPTS ? launch_or_idle(input) : FAILED_DECISION
}

// A live owner is a session at work; a dead one crashed between its claim and the next cut, and is
// recovered through the hand-off's grace/retry path. "Cannot tell" counts as living.
function decide_not_handed_off(input: WakeDecisionInput): WakeDecision {
	if (input.is_owner_live) return WAIT_DECISION

	return decide_launch(input)
}

function decide(input: WakeDecisionInput): WakeDecision {
	if (input.read.kind !== 'carried') return { kind: 'stop', reason: STOP_REASONS[input.read.kind] }
	if (input.read.carry.is_handed_off !== true) return decide_not_handed_off(input)

	return decide_launch(input)
}

// Keyed on the common git directory exactly as the carry record is, so every lane keys alike.
function wake_path(git_directory: string): string {
	return stamp_file.stamp_path(WAKE_PREFIX, git_directory)
}

function wake_log_path(git_directory: string): string {
	return stamp_file.stamp_path(WAKE_LOG_PREFIX, git_directory, WAKE_LOG_SUFFIX)
}

function parse_wake(raw: string): RunWake | undefined {
	return json_value.parse_with(raw, run_wake_schema)
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

// "Cannot tell" counts as running: a refused `--start` is cheaper than two supervisors on one budget.
function is_supervisor_live(wake: RunWake): boolean {
	return process_identity.is_same_process(wake.pid, wake.process_start) !== false
}

// A restart of the same invocation inherits the whole wake state, or it would re-wake a cut inside
// its grace window and under-report `woke` against `cuts`.
function carried_state(existing: RunWake | undefined, invocation: string): Partial<RunWake> {
	if (existing?.invocation !== invocation) return { woke: NO_WAKES }

	return {
		woke: existing.woke,
		woke_at: existing.woke_at,
		attempts: existing.attempts,
		woke_pid: existing.woke_pid,
		spawned: existing.spawned,
		idle_since: existing.idle_since,
		...(existing.profile && { profile: existing.profile }),
	}
}

function is_held_by_live_supervisor(existing: RunWake | undefined): boolean {
	return existing !== undefined && is_supervisor_live(existing)
}

// Sweep a dead marker and create once more, re-reading first in case a live supervisor took it.
function reclaim(target: string, wake: RunWake): RunWake | undefined {
	if (is_held_by_live_supervisor(read_wake(target))) return undefined

	remove_wake(target)

	return stamp_file.create_stamp(target, wake) ? wake : undefined
}

// The exclusive create runs before any sweep — that ordering is what stops two racing `--start`s
// from both owning the record.
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

// A launch marks the attempt and appends its session id; `woke` waits for `count_claim`.
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
		idle_since: undefined,
	}
}

// Marked once: rewritten each pass, the ceiling would slide and never be reached.
function mark_idle(wake: RunWake, now: Date): RunWake {
	return wake.idle_since === undefined ? { ...wake, idle_since: now.toISOString() } : wake
}

// The one place `woke` grows: the record was claimed while a wake mark was outstanding. Without the
// mark this is an ordinary live session, which no supervisor woke.
function count_claim(wake: RunWake): RunWake {
	const woke = wake.woke_at === undefined ? wake.woke : wake.woke + ONE_WAKE

	return {
		...wake,
		woke,
		woke_at: undefined,
		attempts: undefined,
		idle_since: undefined,
	}
}

// Ownership, not existence, decides every write and removal: after a `--stop` that missed the process
// and a fresh `--start`, the old loop must not write into the new supervisor's record. The writer is
// the owner here, unlike `run-carry.ts` where the owner is declared from outside.
function is_own_wake(wake: RunWake): boolean {
	return process_identity.is_own_process(wake.pid, wake.process_start)
}

// Read at the top of each pass, so a superseded supervisor ends before it spawns anything.
function read_own_wake(target: string): RunWake | undefined {
	const wake = read_wake(target)

	return wake !== undefined && is_own_wake(wake) ? wake : undefined
}

// The loop's tidy-up removes only its own record (`--stop` and `reclaim` use `remove_wake` on purpose).
// Three answers, so the caller announces a supersession without re-reading. Read-then-remove leaves a
// residual window the stamp layer cannot close.
function tidy_own_wake(target: string): WakeTidyResult {
	const wake = read_wake(target)

	if (wake === undefined) return 'absent'
	if (!is_own_wake(wake)) return 'superseded'

	remove_wake(target)

	return 'removed'
}

// Writes only where the record is still there and this process's own, so a pass never recreates a
// record `--stop` deleted or overwrites a successor's. A refusal to make damage permanent, not a lock.
function update_wake(target: string, wake: RunWake): boolean {
	if (read_own_wake(target) === undefined) return false

	write_wake(target, wake)

	return true
}

const run_wake = {
	IDLE_CEILING_MS,
	MAX_WAKE_ATTEMPTS,
	WAKE_GRACE_MS,
	claim,
	count_claim,
	count_wake,
	decide,
	fresh_wake,
	is_supervisor_live,
	mark_idle,
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
