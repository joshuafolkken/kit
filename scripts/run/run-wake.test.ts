import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_wake, type WakeDecisionInput } from './run-wake'

// joshuafolkken/kit#1719. The decision is the whole safety property: a supervisor that woke on the
// wrong answer would spend a budget the record calls finished, and one that woke twice for a single
// cut would put two sessions into one invocation.

const NOW = new Date('2026-09-10T12:00:00.000Z')
const DEAD_START = 'a start time no live process has'
const INVOCATION = 'backlogrun --max 5 --idle 30'

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 3,
		filed: 1,
		cuts: 2,
		...overrides,
	}
}

const NO_ATTEMPTS = 0

// What a successor's record looks like to the loop it replaced (joshuafolkken/kit#1727): the pid is
// this very process, so every liveness reading of it answers "running", and only the start time
// separates it from a record this process wrote. It is the state that cannot be produced any other
// way without racing the operating system into reissuing a pid.
const SUCCESSOR = {
	...run_wake.fresh_wake(INVOCATION, NOW),
	pid: process.pid,
	process_start: DEAD_START,
}

// The predecessor is gone by default, which is the ordinary case: `--cut` is the cutting session's
// last write and its process exits directly afterwards.
function input(read: CarryRead, woke_at?: string, attempts = NO_ATTEMPTS): WakeDecisionInput {
	return { read, woke_at, attempts, is_owner_live: false, held_at: undefined, now: NOW }
}

const HANDED_OFF: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }

function long_ago(): string {
	return new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS * 2).toISOString()
}

function overdue(attempts: number): WakeDecisionInput {
	const woke_at = new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS * 2).toISOString()

	return input({ kind: 'carried', carry: carry({ is_handed_off: true }) }, woke_at, attempts)
}

describe('run_wake.decide — whether to wake is the record’s answer', () => {
	it('wakes on a carried record that a cut handed off', () => {
		const decision = run_wake.decide(
			input({ kind: 'carried', carry: carry({ is_handed_off: true }) }),
		)

		expect(decision).toStrictEqual({ kind: 'wake' })
	})

	it('waits on a carried record no cut handed off, because a session is spending it', () => {
		const decision = run_wake.decide(input({ kind: 'carried', carry: carry() }))

		expect(decision).toStrictEqual({ kind: 'wait' })
	})

	// The 8-hour whole-run bound is the carry record's expiry, so this is the only place it is
	// enforced — and enforcing it means never waking, not waking with a shorter budget.
	it('never wakes an expired record, and stops instead', () => {
		const decision = run_wake.decide(
			input({ kind: 'expired', carry: carry({ is_handed_off: true }) }),
		)

		expect(decision).toStrictEqual({ kind: 'stop', reason: 'expired' })
	})

	it('stops when the run ended and no record is left', () => {
		expect(run_wake.decide(input({ kind: 'none' }))).toStrictEqual({
			kind: 'stop',
			reason: 'ended',
		})
	})

	it('stops rather than guesses when the record cannot be read', () => {
		expect(run_wake.decide(input({ kind: 'unreadable' }))).toStrictEqual({
			kind: 'stop',
			reason: 'unreadable',
		})
	})
})

describe('run_wake.decide — the grace window after a wake', () => {
	// Without this the supervisor would forget it had already woken and wake again every interval,
	// putting several sessions into one budget.
	it('stays pending inside the grace window instead of waking again', () => {
		const woke_at = new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS / 2).toISOString()
		const decision = run_wake.decide(
			input({ kind: 'carried', carry: carry({ is_handed_off: true }) }, woke_at),
		)

		expect(decision).toStrictEqual({ kind: 'pending' })
	})

	// Stopping ends a run nobody is watching, so a lost wake is retried before it is called a failure.
	it('retries a lost wake while attempts remain', () => {
		expect(run_wake.decide(overdue(1))).toStrictEqual({ kind: 'wake' })
	})

	it('calls it failed only once the attempts are exhausted', () => {
		expect(run_wake.decide(overdue(run_wake.MAX_WAKE_ATTEMPTS))).toStrictEqual({ kind: 'failed' })
	})

	it('treats a wake stamp it cannot parse as overdue rather than as fresh', () => {
		const spent = run_wake.MAX_WAKE_ATTEMPTS
		const stale = input({ kind: 'carried', carry: carry({ is_handed_off: true }) }, 'x', spent)

		expect(run_wake.decide(stale)).toStrictEqual({ kind: 'failed' })
	})
})

describe('run_wake.decide — waiting out the session that cut', () => {
	// `classify_claim` tests `is_foreign_live_owner` before it tests the hand-off, so a wake issued
	// while the cutting session is still exiting is answered `busy` and claims nothing.
	it('waits out a predecessor that has cut but not yet exited', () => {
		const read: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }

		expect(run_wake.decide({ ...input(read), is_owner_live: true })).toStrictEqual({
			kind: 'hold',
		})
	})

	// An interactive session's process often outlives its own cut. Waited on without a bound, the
	// supervisor would pend for the record's whole life, wake nothing, and end on `expired`, which
	// sends no warning — a silent overnight failure, worse than the `busy` race the wait avoids.
	it('bounds the wait on the predecessor and wakes anyway once it expires', () => {
		const held = { ...input(HANDED_OFF), is_owner_live: true, held_at: long_ago() }

		expect(run_wake.decide(held)).toStrictEqual({ kind: 'wake' })
	})

	it('goes on holding while the predecessor is live and the ceiling has not passed', () => {
		const held = { ...input(HANDED_OFF), is_owner_live: true, held_at: NOW.toISOString() }

		expect(run_wake.decide(held)).toStrictEqual({ kind: 'hold' })
	})

	// **The ceiling is how long the wait may last, never how long it does.** Read once and never again,
	// the predecessor's liveness made every wait cost the whole window — so a predecessor that exited
	// two seconds after the hold still stalled a supervisor whose point is not to stall.
	it('wakes the moment the predecessor exits, without waiting out the ceiling', () => {
		const held = { ...input(HANDED_OFF), is_owner_live: false, held_at: NOW.toISOString() }

		expect(run_wake.decide(held)).toStrictEqual({ kind: 'wake' })
	})
})

describe('run_wake — the mark that bounds the wait', () => {
	it('marks the wait without spending a retry, and apart from the wake mark', () => {
		const marked = run_wake.mark_wait(run_wake.fresh_wake(INVOCATION, NOW), NOW)

		expect(marked.held_at).toBe(NOW.toISOString())
		expect(marked.woke_at).toBeUndefined()
		expect(marked.attempts).toBeUndefined()
		expect(marked.woke).toBe(0)
	})

	// Rewritten on every pass, the mark would measure from the latest pass rather than from the start
	// of the wait, and a predecessor that never exits would be waited on for ever.
	it('does not slide the ceiling when the hold is marked again', () => {
		const marked = run_wake.mark_wait(run_wake.fresh_wake(INVOCATION, NOW), NOW)
		const later = new Date(NOW.getTime() + run_wake.WAKE_GRACE_MS)

		expect(run_wake.mark_wait(marked, later).held_at).toBe(NOW.toISOString())
	})

	it('stops waiting on the predecessor once a wake is already out', () => {
		const read: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }
		const woke_at = new Date(NOW.getTime() - run_wake.WAKE_GRACE_MS * 2).toISOString()

		expect(run_wake.decide({ ...input(read, woke_at, 1), is_owner_live: true })).toStrictEqual({
			kind: 'wake',
		})
	})
})

const scratch = { directory: '', target: '' }

beforeEach(() => {
	scratch.directory = mkdtempSync(path.join(tmpdir(), 'josh-run-wake-test-'))
	scratch.target = path.join(scratch.directory, 'wake.json')
})

afterEach(() => {
	rmSync(scratch.directory, { force: true, recursive: true })
})

describe('run_wake — the supervisor record', () => {
	it('round-trips a record through disk', () => {
		const wake = run_wake.fresh_wake(INVOCATION, NOW)

		run_wake.write_wake(scratch.target, wake)

		expect(run_wake.read_wake(scratch.target)).toStrictEqual(wake)
	})

	it('reads no record where none was written', () => {
		expect(run_wake.read_wake(scratch.target)).toBeUndefined()
	})

	it('names the writing process, so a person can stop it', () => {
		expect(run_wake.fresh_wake(INVOCATION, NOW).pid).toBe(process.pid)
	})

	it('starts at no wakes and counts one per wake', () => {
		const wake = run_wake.fresh_wake(INVOCATION, NOW)

		expect(wake.woke).toBe(0)
		expect(run_wake.count_wake(wake, NOW, 99).woke).toBe(1)
		expect(run_wake.count_wake(wake, NOW, 99).woke_at).toBe(NOW.toISOString())
		expect(run_wake.count_wake(wake, NOW, 99).woke_pid).toBe(99)
	})

	// `woke` is published against the carry record's `cuts`, so a retry of the same cut must not
	// inflate it — otherwise the invariant reports a discrepancy that never happened.
	it('counts a retry as another attempt but not as another wake', () => {
		const first = run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99)
		const retry = run_wake.count_wake(first, NOW, 100)

		expect(retry.woke).toBe(1)
		expect(retry.attempts).toBe(2)
	})

	it('clears the wake mark and the attempts once a session has claimed the carry record', () => {
		const woken = run_wake.count_wake(run_wake.fresh_wake(INVOCATION, NOW), NOW, 99)

		expect(run_wake.clear_wake_mark(woken).woke_at).toBeUndefined()
		expect(run_wake.clear_wake_mark(woken).attempts).toBeUndefined()
		expect(run_wake.clear_wake_mark(woken).woke).toBe(1)
	})
})

describe('run_wake.claim — one supervisor per repository', () => {
	it('refuses a second claim while the first supervisor is running', () => {
		expect(run_wake.claim(scratch.target, INVOCATION, NOW)).toBeDefined()
		expect(run_wake.claim(scratch.target, INVOCATION, NOW)).toBeUndefined()
	})

	// A record naming a process that is provably gone is the crashed supervisor, and it must not lock
	// the repository out of ever starting another one.
	it('replaces a record whose supervisor is provably gone', () => {
		run_wake.write_wake(scratch.target, {
			...run_wake.fresh_wake(INVOCATION, NOW),
			pid: 0,
			process_start: DEAD_START,
		})

		expect(run_wake.claim(scratch.target, INVOCATION, NOW)).toBeDefined()
	})

	// The exclusive create is attempted before anything is removed, so the sweep is what a claim falls
	// back to. A stamp too damaged to read is the case that makes the fallback necessary rather than
	// merely tidy: gated on a record having been read, it would lock `--start` out for good.
	it('replaces a stamp that cannot be read at all', () => {
		writeFileSync(scratch.target, 'not json')

		expect(run_wake.claim(scratch.target, INVOCATION, NOW)).toBeDefined()
		expect(run_wake.read_wake(scratch.target)?.invocation).toBe(INVOCATION)
	})
})

describe('run_wake.claim — what survives a restart', () => {
	// A `--stop` / `--start` cycle mid-run must not reset the count the invariant is published against.
	it('carries the wake count across a restart of the same invocation', () => {
		run_wake.write_wake(scratch.target, {
			...run_wake.fresh_wake(INVOCATION, NOW),
			woke: 4,
			pid: 0,
			process_start: DEAD_START,
		})

		expect(run_wake.claim(scratch.target, INVOCATION, NOW)?.woke).toBe(4)
	})
})

describe('run_wake.claim — the wake state a restart keeps', () => {
	// Dropping these would have a restart inside the grace window launch a second session for the same
	// cut, count it as another cut served, and leave two sessions racing for one record.
	it('carries the wake mark and the attempts across a restart too', () => {
		run_wake.write_wake(scratch.target, {
			...run_wake.fresh_wake(INVOCATION, NOW),
			woke: 2,
			attempts: 2,
			woke_at: NOW.toISOString(),
			pid: 0,
			process_start: DEAD_START,
		})

		const claimed = run_wake.claim(scratch.target, INVOCATION, NOW)

		expect(claimed?.woke_at).toBe(NOW.toISOString())
		expect(claimed?.attempts).toBe(2)
	})

	it('does not carry a different invocation’s count', () => {
		run_wake.write_wake(scratch.target, {
			...run_wake.fresh_wake('some other run', NOW),
			woke: 4,
			pid: 0,
			process_start: DEAD_START,
		})

		expect(run_wake.claim(scratch.target, INVOCATION, NOW)?.woke).toBe(0)
	})

	// `--stop` removes the record; a loop pass still in flight must not write it back.
	it('refuses to write back a record that was removed', () => {
		const wake = run_wake.fresh_wake(INVOCATION, NOW)

		expect(run_wake.update_wake(scratch.target, wake)).toBe(false)

		run_wake.write_wake(scratch.target, wake)

		expect(run_wake.update_wake(scratch.target, wake)).toBe(true)
	})
	it('keys on the given directory, so one repository has one supervisor', () => {
		expect(run_wake.wake_path('/a/.git')).not.toBe(run_wake.wake_path('/b/.git'))
		expect(run_wake.wake_path('/a/.git')).toBe(run_wake.wake_path('/a/.git'))
	})
})

// joshuafolkken/kit#1727. Ownership and existence come apart exactly when it matters: a successor's
// record is there, and is live, and is not this process's — so the existence check reads it as a
// perfectly good target.
describe('run_wake — a record that belongs to another supervisor', () => {
	it('refuses to write back a record another supervisor owns', () => {
		run_wake.write_wake(scratch.target, SUCCESSOR)

		expect(run_wake.update_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))).toBe(false)
		expect(run_wake.read_wake(scratch.target)?.process_start).toBe(DEAD_START)
	})

	// The old loop deleting the record on its way out is what left the run unwatched, with nothing
	// anywhere saying so.
	it('refuses to remove a record another supervisor owns', () => {
		run_wake.write_wake(scratch.target, SUCCESSOR)

		expect(run_wake.remove_own_wake(scratch.target)).toBe(false)
		expect(run_wake.read_wake(scratch.target)).toBeDefined()
	})

	it('removes its own record, which is the ordinary end of a loop', () => {
		run_wake.write_wake(scratch.target, run_wake.fresh_wake(INVOCATION, NOW))

		expect(run_wake.remove_own_wake(scratch.target)).toBe(true)
		expect(run_wake.read_wake(scratch.target)).toBeUndefined()
	})

	// `read_wake` still answers, because `--list` and `--stop` are about whatever record is there.
	it('reads its own record and not another supervisor’s', () => {
		run_wake.write_wake(scratch.target, SUCCESSOR)

		expect(run_wake.read_own_wake(scratch.target)).toBeUndefined()
		expect(run_wake.read_wake(scratch.target)).toBeDefined()
	})

	// An ordinary `--stop` also leaves nothing to remove, and the two must stay distinguishable: the
	// caller writes a superseded note for one of them and not the other.
	it('answers false for an absent record too, which is the ordinary stop', () => {
		expect(run_wake.remove_own_wake(scratch.target)).toBe(false)
		expect(run_wake.read_wake(scratch.target)).toBeUndefined()
	})
})
