import { describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_stranded, type StrandedInput } from './run-stranded'
import type { RunWake } from './run-wake'

const NONE = 0
const A_PID = 4242
const STARTED_AT = '2026-09-22T09:19:34.569Z'
const OWNER_START = 'Tue Sep 22 10:33:08 2026'

function carry(overrides: Partial<RunCarry>): RunCarry {
	return {
		invocation: 'backlogrun',
		started_at: STARTED_AT,
		merged: NONE,
		filed: NONE,
		cuts: NONE,
		failures: NONE,
		outages: NONE,
		is_handed_off: true,
		owner_pid: A_PID,
		owner_start: OWNER_START,
		...overrides,
	}
}

function carried(overrides: Partial<RunCarry> = {}): CarryRead {
	return { kind: 'carried', carry: carry(overrides) }
}

function input(overrides: Partial<StrandedInput>): StrandedInput {
	return { read: carried(), is_owner_live: false, supervisor: run_stranded.GONE, ...overrides }
}

function wake(): RunWake {
	return {
		invocation: 'backlogrun',
		started_at: STARTED_AT,
		pid: A_PID,
		process_start: OWNER_START,
		woke: NONE,
	}
}

describe('run_stranded.is_stranded', () => {
	// AC7 — the four acceptance cases: all three conditions hold, the owner is alive, the successor has
	// claimed, and the record is unreadable.
	it('is stranded when handed off, the owner is gone, and no supervisor is watching', () => {
		expect(run_stranded.is_stranded(input({}))).toBe(true)
	})

	it('is not stranded when the owner is still alive', () => {
		expect(run_stranded.is_stranded(input({ is_owner_live: true }))).toBe(false)
	})

	it('is not stranded when a successor has claimed the handed-off budget', () => {
		const claimed = input({ read: carried({ is_handed_off: false }) })

		expect(run_stranded.is_stranded(claimed)).toBe(false)
	})

	it('is not stranded when the carry record could not be read', () => {
		expect(run_stranded.is_stranded(input({ read: { kind: 'unreadable' } }))).toBe(false)
	})

	// A supervisor whose liveness cannot be established counts as watching — the safe direction, so a
	// strand is never reported on an unprovable supervisor.
	it('is not stranded when the supervisor liveness is unknown', () => {
		expect(run_stranded.is_stranded(input({ supervisor: run_stranded.UNKNOWN }))).toBe(false)
	})

	// An expired budget is the whole-run bound, not a strand: the supervisor stops on it by design.
	it('is not stranded when the budget has expired', () => {
		const expired = input({ read: { kind: 'expired', carry: carry({}) } })

		expect(run_stranded.is_stranded(expired)).toBe(false)
	})
})

describe('run_stranded.supervisor_liveness', () => {
	// AC8 — the three answers a liveness probe gives: alive, gone, and a record the platform cannot read.
	it('is live when the supervisor process is running', () => {
		expect(run_stranded.supervisor_liveness(wake(), () => true)).toBe(run_stranded.LIVE)
	})

	it('is gone when the supervisor process has died', () => {
		expect(run_stranded.supervisor_liveness(wake(), () => false)).toBe(run_stranded.GONE)
	})

	it('is unknown when the platform cannot read the supervisor’s start token', () => {
		expect(run_stranded.supervisor_liveness(wake(), () => undefined)).toBe(run_stranded.UNKNOWN)
	})

	// No wake record at all is `gone`: `run:wake --list` reported `none` in the run this fixes, and
	// nothing watching is exactly the state a strand needs.
	it('is gone when there is no supervisor record at all', () => {
		expect(run_stranded.supervisor_liveness(undefined, () => true)).toBe(run_stranded.GONE)
	})
})
