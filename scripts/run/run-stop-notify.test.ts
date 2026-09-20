import { describe, expect, it } from 'vitest'
import { run_carry, type CarryRead } from './run-carry'
import { run_stop_notify } from './run-stop-notify'

// joshuafolkken/kit#2136. The decision is pinned without a Telegram: what `run:carry --end` sends is
// `plan`'s answer, and the dedup is the record being gone by the second call.

const CARRY = run_carry.fresh_carry(
	'backlogrun',
	run_carry.NO_OWNER,
	new Date('2026-09-19T00:00:00.000Z'),
)
const CARRIED: CarryRead = { kind: 'carried', carry: CARRY }
const EXPIRED: CarryRead = { kind: 'expired', carry: CARRY }
const NONE: CarryRead = { kind: 'none' }
const UNREADABLE: CarryRead = { kind: 'unreadable' }
const REASON = 'every remaining child is blocked behind a parked one'

describe('planning the stop the person is told about', () => {
	it('plans a notice for a stop over a carried record', () => {
		expect(run_stop_notify.plan(CARRIED, REASON)).toStrictEqual({ reason: REASON })
	})

	it('plans a notice over an expired record too', () => {
		expect(run_stop_notify.plan(EXPIRED, REASON)).toStrictEqual({ reason: REASON })
	})

	it('plans nothing once the record is gone, so a re-run never sends twice', () => {
		expect(run_stop_notify.plan(NONE, REASON)).toBeUndefined()
	})

	it('plans nothing for an unreadable record it cannot honestly speak for', () => {
		expect(run_stop_notify.plan(UNREADABLE, REASON)).toBeUndefined()
	})

	it('plans nothing for a clean finish that names no stop reason', () => {
		expect(run_stop_notify.plan(CARRIED, undefined)).toBeUndefined()
	})

	it('plans nothing for an empty stop reason', () => {
		expect(run_stop_notify.plan(CARRIED, '')).toBeUndefined()
	})
})
