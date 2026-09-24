import type { CarryRead } from './run-carry'
import {
	run_wake,
	type RunWake,
	type WakeDecision,
	type WakeDecisionInput,
	type WakeStopReason,
} from './run-wake'
import type { LaunchResult } from './run-wake-session'

// The supervisor's body: read the carry record, decide, act, sleep, repeat (joshuafolkken/kit#1719).
//
// **Everything it touches is a port**, so the loop is testable without a real process, a real clock or
// a real Telegram. What is left here is the sequencing, which is the part worth pinning: a run that
// woke twice for one cut, or that stopped on a record it had not re-read, would be wrong in a way no
// unit test of `decide` alone could see.
//
// **The supervisor re-reads its own record every pass, and that is how `--stop` works.** Removing the
// record is the stop signal; the signal sent alongside it only shortens the wait. So a stop is honored
// even where the process cannot be signalled, and the supervisor never outlives a record a person
// deliberately removed.

const STOPPED_REASON: WakeStopReason = 'stopped'
const FAILED_REASON: WakeStopReason = 'failed'
const NO_ATTEMPTS = 0
const STOPPED_BY_PERSON: LoopStop = { reason: STOPPED_REASON, note: undefined }
// **The back-off after repeated whiffs, and its ceiling** (joshuafolkken/kit#2417). While a launch is
// deferred for want of work, each wait is as long as the idle stretch so far — so the polling interval
// doubles pass by pass — capped at this multiple of the configured one. Eight times the one-minute
// default is eight minutes: far fewer backlog reads over a long empty stretch, and still well inside
// the idle ceiling, so work that appears is picked up within one capped wait.
const MAX_BACKOFF_FACTOR = 8

interface LoopPorts {
	// The carry record, re-read every pass rather than cached: it is written by the parent loop of a
	// different session, which is the whole point of reading it here.
	read_carry: () => CarryRead
	// Whether the process named on the carry record is still running. The cutting session writes
	// `--cut` and then exits, so the two moments are not the same one and the supervisor has to wait
	// out the second — `run-wake.ts` → `WakeDecisionInput.is_owner_live`.
	is_owner_live: (read: CarryRead) => boolean
	// A compatibility probe for the wake decision. Production lets the resident driver inspect work,
	// including an empty idle watch, without starting an AI session.
	has_work: (read: CarryRead) => Promise<boolean | undefined>
	// **The forced transcript id is generated here and handed to `wake`** (joshuafolkken/kit#2407), so
	// the loop stays deterministic under test — a fixture returns a known id — while production draws a
	// fresh UUID. The same id is recorded on the wake record, which is how `josh time --run` later knows
	// the session was one this supervisor started.
	new_session_id: () => string
	// Hands the carry record from the supervisor-owned driver to a judgment session.
	hand_off: () => void
	// Runs the deterministic backlog driver. A normal completion never calls `wake`.
	drive: () => Promise<DriveResult>
	wake: (invocation: string, session_id: string, material: string) => LaunchResult
	sleep: (milliseconds: number) => Promise<void>
	now: () => Date
}

type DriveResult =
	{ kind: 'finished' } | { kind: 'judgment'; material: string } | { kind: 'failed'; note: string }

interface LoopStop {
	reason: WakeStopReason
	// What went wrong, where anything did. It is what the completion warning quotes, so a failure never
	// reaches the person as a bare verdict they then have to go and diagnose.
	note: string | undefined
}

type StepOutcome = { kind: 'continue'; wake: RunWake } | { kind: 'stop'; stop: LoopStop }

function stopped(reason: WakeStopReason, note?: string): StepOutcome {
	return { kind: 'stop', stop: { reason, note } }
}

// The grace window elapsing is the launch-failure detector, so the note has to say what was expected
// rather than only that something failed — the person reading it has no other record of the attempt.
// **The last process is named because it is not killed**: a session that is merely slow is still doing
// the run's work, so the warning hands the person something to check rather than destroying it.
function wake_failure_note(wake: RunWake): string {
	const attempts = String(wake.attempts ?? NO_ATTEMPTS)
	const last = wake.woke_pid === undefined ? 'none' : `process ${String(wake.woke_pid)}`

	return `woke a session for "${wake.invocation}" ${attempts} time(s) and none of them claimed the carry record; the last one was ${last}, which may still be running`
}

// The hand-off is written before the launch, never after: a successor that boots fast enough to run
// `--begin` before a post-launch write would read the record un-handed-off and be answered `standing`.
async function wake_step(wake: RunWake, ports: LoopPorts): Promise<StepOutcome> {
	const driven = await ports.drive()
	if (driven.kind === 'finished') return stopped('ended')
	if (driven.kind === 'failed') return stopped(FAILED_REASON, driven.note)

	const session_id = ports.new_session_id()

	ports.hand_off()

	const result = ports.wake(wake.invocation, session_id, driven.material)

	if (result.kind === 'failed') return stopped(FAILED_REASON, result.note)

	return { kind: 'continue', wake: run_wake.count_wake(wake, ports.now(), result.pid, session_id) }
}

// A `wait` means the woken session has claimed the carry record, so the wake mark is cleared and the
// next cut starts the grace window afresh — **and it is the only pass on which `woke` may grow**
// (joshuafolkken/kit#1746), because arriving here is the supervisor observing that a record it was
// waiting on has been taken over. A `hold` starts the ceiling on a wait without launching
// anything — the bounded wait on a predecessor that has cut but not yet exited, which ends the moment
// that predecessor does. A `pending` keeps what is there, because the window it is measured from is
// still open.
function continue_step(wake: RunWake, decision: WakeDecision, ports: LoopPorts): StepOutcome {
	if (decision.kind === 'wait') return { kind: 'continue', wake: run_wake.count_claim(wake) }

	if (decision.kind === 'hold') {
		return { kind: 'continue', wake: run_wake.mark_wait(wake, ports.now()) }
	}

	if (decision.kind === 'idle') {
		return { kind: 'continue', wake: run_wake.mark_idle(wake, ports.now()) }
	}

	return { kind: 'continue', wake }
}

async function step(wake: RunWake, decision: WakeDecision, ports: LoopPorts): Promise<StepOutcome> {
	if (decision.kind === 'stop') return stopped(decision.reason)
	if (decision.kind === 'failed') return stopped(FAILED_REASON, wake_failure_note(wake))
	if (decision.kind === 'wake') return await wake_step(wake, ports)

	return continue_step(wake, decision, ports)
}

// `has_work` starts as "cannot tell", which never defers anything — so this first input decides every
// branch except whether a launch has work to go to.
function decision_input(wake: RunWake, ports: LoopPorts): WakeDecisionInput {
	const read = ports.read_carry()

	return {
		read,
		woke_at: wake.woke_at,
		attempts: wake.attempts ?? NO_ATTEMPTS,
		is_owner_live: ports.is_owner_live(read),
		held_at: wake.held_at,
		has_work: undefined,
		idle_since: wake.idle_since,
		now: ports.now(),
	}
}

// **Work is asked about only where the answer could change the decision** (joshuafolkken/kit#2417):
// on a pass the record alone would launch from. Every other pass — the in-flight wait, the pending
// grace window, the hold — decides from the record as before and costs no backlog read.
async function decide_pass(wake: RunWake, ports: LoopPorts): Promise<WakeDecision> {
	const input = decision_input(wake, ports)
	const decision = run_wake.decide(input)

	if (decision.kind !== 'wake') return decision

	return run_wake.decide({ ...input, has_work: await ports.has_work(input.read) })
}

// The wait before the next pass: the configured interval, stretched while a launch is being deferred
// to the length of the idle stretch so far and capped at `MAX_BACKOFF_FACTOR` times the interval.
function next_interval(wake: RunWake | undefined, interval_ms: number, now: Date): number {
	const idle_since = wake?.idle_since === undefined ? NaN : Date.parse(wake.idle_since)

	if (Number.isNaN(idle_since)) return interval_ms

	const stretched = Math.max(interval_ms, now.getTime() - idle_since)

	return Math.min(stretched, interval_ms * MAX_BACKOFF_FACTOR)
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
// One pass: decide, act, write the result back. `undefined` means carry on to the next interval.
async function run_pass(
	target: string,
	wake: RunWake,
	ports: LoopPorts,
): Promise<LoopStop | undefined> {
	const outcome = await step(wake, await decide_pass(wake, ports), ports)

	if (outcome.kind === 'stop') return outcome.stop

	return run_wake.update_wake(target, outcome.wake) ? undefined : STOPPED_BY_PERSON
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
//
// **`read_own_wake` rather than `read_wake`, and the difference is a whole pass** (joshuafolkken/kit#1727).
// A record that has become a *successor's* is not this loop's to act on, and reading it back would
// have this pass decide from another supervisor's counters — spawning a session for a cut that
// supervisor is already serving, and only then finding the write-back refused. Read as owned or not
// at all, the replaced loop ends here, quietly and before it does anything: the run is not
// unattended, because the supervisor that took the record over is watching it.
async function run_loop(target: string, ports: LoopPorts, interval_ms: number): Promise<LoopStop> {
	let wake = run_wake.read_own_wake(target)

	while (wake !== undefined) {
		const stop = await run_pass(target, wake, ports)

		if (stop !== undefined) return stop

		await ports.sleep(next_interval(run_wake.read_own_wake(target), interval_ms, ports.now()))
		wake = run_wake.read_own_wake(target)
	}

	return STOPPED_BY_PERSON
}

const run_wake_loop = {
	FAILED_REASON,
	MAX_BACKOFF_FACTOR,
	STOPPED_REASON,
	next_interval,
	run_loop,
	step,
}

export type { DriveResult, LoopPorts, LoopStop }
export { run_wake_loop }
