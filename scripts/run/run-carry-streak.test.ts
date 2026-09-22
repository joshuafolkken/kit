import { describe, expect, it } from 'vitest'
import {
	run_carry_streak,
	type StreakCarry,
	type StreakChange,
	type StreakState,
} from './run-carry-streak'

// joshuafolkken/kit#2317: one network event hit four in-flight children within seconds and was booked
// as four outages, tripping the limit of three though the API was alive. These pin the fold that fixes
// it — a burst inside the window counts once, genuinely spaced outages still accumulate — and that the
// failure-streak reset the module inherited from `run-carry.ts` is unchanged.

const T0 = new Date('2026-09-22T00:00:00.000Z')
// +60s: inside the 120s fold window, so the same network event.
const WITHIN = new Date('2026-09-22T00:01:00.000Z')
// +3min and +6min: outside it, so distinct outages — the spacing a re-dispatched dead API produces.
const BEYOND = new Date('2026-09-22T00:03:00.000Z')
const BEYOND_AGAIN = new Date('2026-09-22T00:06:00.000Z')
const OUTAGE = { outages: 1 }

function carry(overrides: Partial<StreakCarry> = {}): StreakCarry {
	return { failures: 0, outages: 0, ...overrides }
}

// The state after the first outage of a streak: counted, with its timestamp recorded for the window.
function first_outage(): StreakState {
	return run_carry_streak.next_state(carry(), OUTAGE, T0)
}

// Apply a sequence of changes in order, threading each result into the next — a loop rather than
// `reduce`, which the lint bans for readability.
function run_sequence(steps: ReadonlyArray<{ change: StreakChange; now: Date }>): StreakState {
	let state: StreakState = { failures: 0, outages: 0, last_outage_at: undefined }

	for (const step of steps) state = run_carry_streak.next_state(state, step.change, step.now)

	return state
}

describe('the outage fold (joshuafolkken/kit#2317)', () => {
	it('counts the first outage and records when it was booked', () => {
		const next = first_outage()

		expect(next.outages).toBe(1)
		expect(next.last_outage_at).toBe(T0.toISOString())
	})

	it('folds a second outage inside the window into the same step', () => {
		const next = run_carry_streak.next_state(first_outage(), OUTAGE, WITHIN)

		expect(next.outages).toBe(1)
		expect(next.last_outage_at).toBe(T0.toISOString())
	})

	it('counts a second outage outside the window as a distinct event', () => {
		const next = run_carry_streak.next_state(first_outage(), OUTAGE, BEYOND)

		expect(next.outages).toBe(2)
		expect(next.last_outage_at).toBe(BEYOND.toISOString())
	})

	it('counts an outage when the recorded timestamp cannot be parsed', () => {
		const stale = carry({ outages: 1, last_outage_at: 'not-a-date' })

		expect(run_carry_streak.next_state(stale, OUTAGE, WITHIN).outages).toBe(2)
	})
})

describe('one event folds, a dead API still trips the guard', () => {
	it('folds a whole burst of simultaneous outages to one', () => {
		const burst = [T0, WITHIN, WITHIN, WITHIN].map((now) => ({ change: OUTAGE, now }))

		expect(run_sequence(burst).outages).toBe(1)
	})

	it('reaches the guard limit over spaced re-dispatch attempts', () => {
		const attempts = [T0, BEYOND, BEYOND_AGAIN].map((now) => ({ change: OUTAGE, now }))

		expect(run_sequence(attempts).outages).toBe(3)
	})
})

describe('the reachability reset', () => {
	it('clears the streak and the fold timestamp when a child merges', () => {
		const next = run_carry_streak.next_state(first_outage(), { merged: 1 }, WITHIN)

		expect(next.outages).toBe(0)
		expect(next.last_outage_at).toBeUndefined()
	})

	it('clears the outage streak when a child fails on its own', () => {
		const next = run_carry_streak.next_state(first_outage(), { failures: 1 }, WITHIN)

		expect(next.outages).toBe(0)
		expect(next.failures).toBe(1)
	})

	it('leaves the streak and its timestamp untouched by a bookkeeping-only change', () => {
		const next = run_carry_streak.next_state(first_outage(), {}, WITHIN)

		expect(next.outages).toBe(1)
		expect(next.last_outage_at).toBe(T0.toISOString())
	})
})

describe('the failure streak', () => {
	it('rises with each failed child and resets on a merge', () => {
		const two = run_sequence([
			{ change: { failures: 1 }, now: T0 },
			{ change: { failures: 1 }, now: T0 },
		])

		expect(two.failures).toBe(2)
		expect(run_carry_streak.next_state(carry({ failures: 2 }), { merged: 1 }, T0).failures).toBe(0)
	})
})
