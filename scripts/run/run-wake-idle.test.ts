import { describe, expect, it } from 'vitest'
import type { CarryRead, RunCarry } from './run-carry'
import { run_wake, type WakeDecisionInput } from './run-wake'

// joshuafolkken/kit#2417. The decision used to read the carry record alone, so a session was launched
// whether or not it would find work. These pin the gate every launch now passes: work (or a read that
// cannot tell) wakes, no work defers, and a deferral that outlives the idle ceiling wakes anyway so the
// run is still finished by a session rather than left to expire.

const NOW = new Date('2026-09-10T12:00:00.000Z')
const INVOCATION = 'backlogrun --max 5 --idle 30'

function carry(overrides: Partial<RunCarry> = {}): RunCarry {
	return {
		invocation: INVOCATION,
		started_at: '2026-09-10T08:00:00.000Z',
		merged: 3,
		filed: 1,
		cuts: 2,
		failures: 0,
		outages: 0,
		...overrides,
	}
}

const HANDED_OFF: CarryRead = { kind: 'carried', carry: carry({ is_handed_off: true }) }
const IN_FLIGHT: CarryRead = { kind: 'carried', carry: carry() }

function ago(milliseconds: number): string {
	return new Date(NOW.getTime() - milliseconds).toISOString()
}

function input(overrides: Partial<WakeDecisionInput> = {}): WakeDecisionInput {
	return {
		read: HANDED_OFF,
		woke_at: undefined,
		attempts: 0,
		is_owner_live: false,
		held_at: undefined,
		now: NOW,
		...overrides,
	}
}

describe('run_wake.decide — a launch goes only where there is work', () => {
	it('wakes when there is work', () => {
		expect(run_wake.decide(input({ has_work: true }))).toStrictEqual({ kind: 'wake' })
	})

	it('does not wake when there is no work, and answers idle instead', () => {
		expect(run_wake.decide(input({ has_work: false }))).toStrictEqual({ kind: 'idle' })
	})

	// A failed backlog read is not an empty backlog: deferring on it would stall a run that had work.
	it('wakes when whether there is work cannot be told', () => {
		expect(run_wake.decide(input({ has_work: undefined }))).toStrictEqual({ kind: 'wake' })
	})

	it('defers the recovery of a dead owner the same way when there is no work', () => {
		expect(run_wake.decide(input({ read: IN_FLIGHT, has_work: false }))).toStrictEqual({
			kind: 'idle',
		})
	})

	// A retry into an empty backlog is the same whiff as a first wake into one.
	it('defers a retry of a lost wake when there is no work', () => {
		const lost = input({ woke_at: ago(run_wake.WAKE_GRACE_MS * 2), attempts: 1, has_work: false })

		expect(run_wake.decide(lost)).toStrictEqual({ kind: 'idle' })
	})

	it('never turns a pending wake into idle, because no launch is being asked for', () => {
		const pending = input({ woke_at: NOW.toISOString(), attempts: 1, has_work: false })

		expect(run_wake.decide(pending)).toStrictEqual({ kind: 'pending' })
	})
})

describe('run_wake.decide — the idle ceiling', () => {
	it('keeps deferring while the idle stretch is inside the ceiling', () => {
		const idle = input({ has_work: false, idle_since: ago(run_wake.IDLE_CEILING_MS - 1) })

		expect(run_wake.decide(idle)).toStrictEqual({ kind: 'idle' })
	})

	// The run still has to be finished by a session — the drain, the retrospective and the carry end —
	// so a backlog that stays empty wakes one once the ceiling is passed rather than never.
	it('wakes once the idle stretch has passed the ceiling', () => {
		const idle = input({ has_work: false, idle_since: ago(run_wake.IDLE_CEILING_MS + 1) })

		expect(run_wake.decide(idle)).toStrictEqual({ kind: 'wake' })
	})

	it('reads an unparsable idle mark as past the ceiling, the direction that wakes', () => {
		expect(run_wake.decide(input({ has_work: false, idle_since: 'garbage' }))).toStrictEqual({
			kind: 'wake',
		})
	})
})

describe('run_wake — the idle mark', () => {
	it('marks the idle stretch once, so the ceiling does not slide', () => {
		const marked = run_wake.mark_idle(run_wake.fresh_wake(INVOCATION, NOW), NOW)
		const later = new Date(NOW.getTime() + run_wake.IDLE_CEILING_MS)

		expect(run_wake.mark_idle(marked, later).idle_since).toBe(NOW.toISOString())
	})

	it('clears the idle mark when a session is launched', () => {
		const marked = run_wake.mark_idle(run_wake.fresh_wake(INVOCATION, NOW), NOW)

		expect(run_wake.count_wake(marked, NOW, 4242, 'sid-1').idle_since).toBeUndefined()
	})

	it('clears the idle mark when a session claims the record', () => {
		const marked = run_wake.mark_idle(run_wake.fresh_wake(INVOCATION, NOW), NOW)

		expect(run_wake.count_claim(marked).idle_since).toBeUndefined()
	})

	// The schema strips an undeclared field, which would restart the ceiling on every pass.
	it('keeps the idle mark through the round-trip to disk', () => {
		const marked = run_wake.mark_idle(run_wake.fresh_wake(INVOCATION, NOW), NOW)
		const parsed = run_wake.parse_wake(JSON.stringify(marked))

		expect(parsed?.idle_since).toBe(NOW.toISOString())
	})
})
