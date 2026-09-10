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

interface LoopPorts {
	// The carry record, re-read every pass rather than cached: it is written by the parent loop of a
	// different session, which is the whole point of reading it here.
	read_carry: () => CarryRead
	// Whether the process named on the carry record is still running. The cutting session writes
	// `--cut` and then exits, so the two moments are not the same one and the supervisor has to wait
	// out the second — `run-wake.ts` → `WakeDecisionInput.is_owner_live`.
	is_owner_live: (read: CarryRead) => boolean
	wake: (invocation: string) => LaunchResult
	sleep: (milliseconds: number) => Promise<void>
	now: () => Date
}

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

function wake_step(wake: RunWake, ports: LoopPorts): StepOutcome {
	const result = ports.wake(wake.invocation)

	if (result.kind === 'failed') return stopped(FAILED_REASON, result.note)

	return { kind: 'continue', wake: run_wake.count_wake(wake, ports.now(), result.pid) }
}

// A `wait` means the woken session has claimed the carry record, so the wake mark is cleared and the
// next cut starts the grace window afresh. A `hold` starts the ceiling on a wait without launching
// anything — the bounded wait on a predecessor that has cut but not yet exited, which ends the moment
// that predecessor does. A `pending` keeps what is there, because the window it is measured from is
// still open.
function continue_step(wake: RunWake, decision: WakeDecision, ports: LoopPorts): StepOutcome {
	if (decision.kind === 'wait') return { kind: 'continue', wake: run_wake.clear_wake_mark(wake) }

	if (decision.kind === 'hold') {
		return { kind: 'continue', wake: run_wake.mark_wait(wake, ports.now()) }
	}

	return { kind: 'continue', wake }
}

function step(wake: RunWake, decision: WakeDecision, ports: LoopPorts): StepOutcome {
	if (decision.kind === 'stop') return stopped(decision.reason)
	if (decision.kind === 'failed') return stopped(FAILED_REASON, wake_failure_note(wake))
	if (decision.kind === 'wake') return wake_step(wake, ports)

	return continue_step(wake, decision, ports)
}

function decision_input(wake: RunWake, ports: LoopPorts): WakeDecisionInput {
	const read = ports.read_carry()

	return {
		read,
		woke_at: wake.woke_at,
		attempts: wake.attempts ?? NO_ATTEMPTS,
		is_owner_live: ports.is_owner_live(read),
		held_at: wake.held_at,
		now: ports.now(),
	}
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
// One pass: decide, act, write the result back. `undefined` means carry on to the next interval.
function run_pass(target: string, wake: RunWake, ports: LoopPorts): LoopStop | undefined {
	const outcome = step(wake, run_wake.decide(decision_input(wake, ports)), ports)

	if (outcome.kind === 'stop') return outcome.stop

	return run_wake.update_wake(target, outcome.wake) ? undefined : STOPPED_BY_PERSON
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
async function run_loop(target: string, ports: LoopPorts, interval_ms: number): Promise<LoopStop> {
	let wake = run_wake.read_wake(target)

	while (wake !== undefined) {
		const stop = run_pass(target, wake, ports)

		if (stop !== undefined) return stop

		await ports.sleep(interval_ms)
		wake = run_wake.read_wake(target)
	}

	return STOPPED_BY_PERSON
}

const run_wake_loop = {
	FAILED_REASON,
	STOPPED_REASON,
	run_loop,
	step,
}

export type { LoopPorts, LoopStop, StepOutcome }
export { run_wake_loop }
