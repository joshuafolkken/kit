import { error_text } from '#scripts/lib/error-message'
import { poll } from '#scripts/lib/poll'
import type { CarryRead } from '#scripts/run/carry/run-carry'
import {
	run_wake,
	type RunWake,
	type WakeDecision,
	type WakeDecisionInput,
	type WakeStopReason,
} from './run-wake'
import type { LaunchResult } from './run-wake-session'

// The supervisor's body: read the carry record, decide, act, sleep, repeat.
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
const RELOAD_REASON: WakeStopReason = 'reload'
const NO_ATTEMPTS = 0
const STOPPED_BY_PERSON: LoopStop = { reason: STOPPED_REASON, note: undefined }
const CODE_CHANGED: LoopStop = { reason: RELOAD_REASON, note: undefined }

interface LoopPorts {
	refresh?: () => void
	session_failure?: () => string | undefined
	// The carry record, re-read every pass rather than cached: it is written by the parent loop of a
	// different session, which is the whole point of reading it here.
	read_carry: () => CarryRead
	// Whether the process named on the carry record is still running, which tells a session at work
	// from a crashed one — `run-wake.ts` → `WakeDecisionInput.is_owner_live`.
	is_owner_live: (read: CarryRead) => boolean
	// A compatibility probe for the wake decision. Production lets the resident driver inspect work,
	// including an empty idle watch, without starting an AI session.
	has_work: (read: CarryRead) => Promise<boolean | undefined>
	// **The forced transcript id is generated here and handed to `wake`**, so
	// the loop stays deterministic under test — a fixture returns a known id — while production draws a
	// fresh UUID. The same id is recorded on the wake record, which is how `josh time --run` later knows
	// the session was one this supervisor started.
	new_session_id: () => string
	// Hands the carry record from the supervisor-owned driver to the judgment session `session_id`
	// names, adopting it for that session (`run-wake-handoff.ts`).
	hand_off: (session_id: string) => void
	// Runs the deterministic backlog driver. A normal completion never calls `wake`.
	drive: () => Promise<DriveResult>
	wake: (invocation: string, session_id: string, material: string) => LaunchResult
	// Wakes the triage session beside the driver: the record stays this supervisor's, and the session's
	// process is named on the driver's kept resume line (joshuafolkken/kit#7120).
	wake_beside: (invocation: string, session_id: string, material: string) => LaunchResult
	sleep: (milliseconds: number) => Promise<void>
	now: () => Date
	// Closes again a lane a process outlived, once the process is gone (`lane_close.retry_closes`), and
	// withdraws a lane whose issue was closed as not planned (`lane_withdraw_closed.withdraw_closed`).
	retry_closes: () => Promise<void>
	// Whether the code this process loaded differs from the code on disk now (`run-wake-code.ts`).
	is_code_stale: () => Promise<boolean>
}

// `released`: the carry record ended while the driver paused, or the driver's window was spent, so
// there is nothing to hand on and the next pass decides from the record whether the run ends, reloads
// or drives on.
type DriveResult =
	| { kind: 'finished' }
	| { kind: 'released' }
	| { kind: 'judgment' | 'triage'; material: string }
	| { kind: 'failed'; note: string }

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

// **Triage is no hand-off** (joshuafolkken/kit#7120): the record stays this supervisor's, so the next
// pass drives again at once — collecting and filling lanes while the session judges — and no wake is
// counted, which would hold that pass in the grace window a hand-off waits through.
function beside_step(wake: RunWake, material: string, ports: LoopPorts): StepOutcome {
	const result = ports.wake_beside(wake.invocation, ports.new_session_id(), material)

	return result.kind === 'failed' ? stopped(FAILED_REASON, result.note) : { kind: 'continue', wake }
}

// The hand-off is written before the launch, never after: a session that boots fast enough to count
// before a post-launch write would meet a record still the supervisor's.
function handoff_step(wake: RunWake, material: string, ports: LoopPorts): StepOutcome {
	const session_id = ports.new_session_id()

	ports.hand_off(session_id)

	const result = ports.wake(wake.invocation, session_id, material)

	if (result.kind === 'failed') return stopped(FAILED_REASON, result.note)

	return { kind: 'continue', wake: run_wake.count_wake(wake, ports.now(), result.pid, session_id) }
}

async function wake_step(wake: RunWake, ports: LoopPorts): Promise<StepOutcome> {
	const driven = await ports.drive()
	if (driven.kind === 'finished') return stopped('ended')
	if (driven.kind === 'failed') return stopped(FAILED_REASON, driven.note)
	if (driven.kind === 'released') return { kind: 'continue', wake }

	return driven.kind === 'triage'
		? beside_step(wake, driven.material, ports)
		: handoff_step(wake, driven.material, ports)
}

// A `wait` means the woken session is at work on the carry record, so the wake mark is cleared and the
// next cut starts the grace window afresh — **and it is the only pass on which `woke` may grow**,
// because arriving here is the supervisor observing that a record it was
// waiting on has been taken over. A `pending` keeps what is there, because the window it is measured
// from is still open.
function continue_step(wake: RunWake, decision: WakeDecision, ports: LoopPorts): StepOutcome {
	if (decision.kind === 'wait') return { kind: 'continue', wake: run_wake.count_claim(wake) }

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
		has_work: undefined,
		idle_since: wake.idle_since,
		now: ports.now(),
	}
}

// **Work is asked about only where the answer could change the decision**: on a pass the record alone
// would launch from. Every other pass — the in-flight wait, the pending grace window — decides from
// the record alone and costs no backlog read.
async function decide_pass(wake: RunWake, ports: LoopPorts): Promise<WakeDecision> {
	const input = decision_input(wake, ports)
	const decision = run_wake.decide(input)

	if (decision.kind !== 'wake') return decision

	return run_wake.decide({ ...input, has_work: await ports.has_work(input.read) })
}

// A lane whose close a process outlived ends once the process is gone (joshuafolkken/kit#4300), and
// a lane whose issue was closed as not planned is withdrawn (joshuafolkken/kit#4915). A failed retry
// is the next pass's to try again, never a reason to stop the run.
async function retry_closes(ports: LoopPorts): Promise<void> {
	try {
		await ports.retry_closes()
	} catch (error) {
		error_text.trace_swallowed('run_wake_loop.retry_closes', error)
	}
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
// One pass: decide, act, write the result back. `undefined` means carry on to the next interval.
//
// **A pass boundary is where the supervisor reloads its code** (joshuafolkken/kit#4509): no driver
// is running and no session is being launched, so a successor on the new code takes over without
// stopping any lane. A record already removed ends the loop before this pass is reached, and a carry
// record that ended or became unreadable stops the run before the code is checked, so a reload never
// hands a finished run to a successor.
async function preflight_stop(
	decision: WakeDecision,
	ports: LoopPorts,
): Promise<LoopStop | undefined> {
	if (decision.kind === 'stop') return undefined
	const failure = ports.session_failure?.()
	if (failure !== undefined) return { reason: FAILED_REASON, note: failure }

	return (await ports.is_code_stale()) ? CODE_CHANGED : undefined
}

async function run_pass(
	target: string,
	wake: RunWake,
	ports: LoopPorts,
): Promise<LoopStop | undefined> {
	const decision = await decide_pass(wake, ports)
	const stop = await preflight_stop(decision, ports)
	if (stop !== undefined) return stop

	await retry_closes(ports)

	const outcome = await step(wake, decision, ports)

	if (outcome.kind === 'stop') return outcome.stop

	return run_wake.update_wake(target, outcome.wake) ? undefined : STOPPED_BY_PERSON
}

// The record is re-read at the top of every pass rather than carried in a variable, so a `--stop` that
// removed it ends the loop at the next interval and a `--list` reads what the loop actually wrote.
//
// **The wait between two passes is the configured interval, however long the run has been idle**: a
// launch deferred for want of work is asked about again as soon as a running one would be.
//
// **`read_own_wake` rather than `read_wake`, and the difference is a whole pass.**
// A record that has become a *successor's* is not this loop's to act on, and reading it back would
// have this pass decide from another supervisor's counters — spawning a session for a cut that
// supervisor is already serving, and only then finding the write-back refused. Read as owned or not
// at all, the replaced loop ends here, quietly and before it does anything: the run is not
// unattended, because the supervisor that took the record over is watching it.
// A driver window already waited. Recheck ownership and reload code immediately before the next
// driver, so the supervisor's interval cannot hide a not_before deadline between windows. A triage
// woken beside the driver re-drives at once too, so no lane waits out the interval while it judges.
function without_release_gap(ports: LoopPorts): LoopPorts {
	let is_released = false

	return {
		...ports,
		drive: async () => {
			const result = await ports.drive()

			is_released = result.kind === 'released' || result.kind === 'triage'

			return result
		},
		sleep: async (milliseconds) => {
			const duration = is_released ? 0 : milliseconds

			is_released = false
			await ports.sleep(duration)
		},
	}
}

function refreshed_wake(target: string, ports: LoopPorts): RunWake | undefined {
	if (run_wake.read_own_wake(target) === undefined) return undefined
	ports.refresh?.()

	return run_wake.read_own_wake(target)
}

async function run_loop(target: string, ports: LoopPorts, interval_ms: number): Promise<LoopStop> {
	const continuous = without_release_gap(ports)

	return await poll.wait_for(
		async () => {
			const wake = refreshed_wake(target, continuous)

			return wake === undefined ? STOPPED_BY_PERSON : await run_pass(target, wake, continuous)
		},
		{ interval_ms, sleeper: continuous.sleep },
	)
}

const run_wake_loop = {
	FAILED_REASON,
	RELOAD_REASON,
	run_loop,
}

export type { DriveResult, LoopPorts, LoopStop }
export { run_wake_loop }
