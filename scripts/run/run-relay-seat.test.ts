import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { CarryRead } from './run-carry'
import { run_relay_seat, type RelaySeat } from './run-relay-seat'

// joshuafolkken/kit#2480. The relay seat names the attached session that relays a `backlogrun` past the
// hand-off, when the record's owner has been rewritten to the headless successor.

const TEMPORARY = mkdtempSync(path.join(tmpdir(), 'josh-run-relay-seat-'))
const CARRY_TARGET = path.join(TEMPORARY, 'carry.json')
const OTHER_TARGET = path.join(TEMPORARY, 'other.json')
const ATTACHED_PID = 4242
const SUCCESSOR_PID = 5151
const STARTED_AT = '2026-09-23T10:00:00.000Z'
const EARLIER_RUN = '2026-09-22T10:00:00.000Z'
const SEAT: RelaySeat = { pid: ATTACHED_PID, started_at: STARTED_AT }

function ancestry(): ReadonlySet<number> {
	return new Set([ATTACHED_PID, 1])
}

afterAll(() => {
	rmSync(TEMPORARY, { force: true, recursive: true })
	rmSync(run_relay_seat.seat_path(CARRY_TARGET), { force: true })
	rmSync(run_relay_seat.seat_path(OTHER_TARGET), { force: true })
})

function read_of(kind: 'carried' | 'expired', owner_pid: number | undefined): CarryRead {
	const carry = { invocation: 'backlogrun', started_at: STARTED_AT, cuts: 1 }

	return {
		kind,
		carry: { ...carry, merged: 0, filed: 0, failures: 0, outages: 0, owner_pid },
	}
}

const BEFORE_CUT = read_of('carried', ATTACHED_PID)
const HANDED_OFF = read_of('carried', SUCCESSOR_PID)

describe('run_relay_seat.take / read_seat', () => {
	it('reads back the pid and the run the cut recorded', () => {
		run_relay_seat.take(CARRY_TARGET, ATTACHED_PID, STARTED_AT)

		expect(run_relay_seat.read_seat(CARRY_TARGET)).toStrictEqual(SEAT)
	})

	it('records nothing for a cut that declared no owner', () => {
		run_relay_seat.take(OTHER_TARGET, undefined, STARTED_AT)

		expect(run_relay_seat.read_seat(OTHER_TARGET)).toBeUndefined()
	})
})

describe('run_relay_seat.is_seated', () => {
	it('seats the owner of a running record before any cut', () => {
		expect(run_relay_seat.is_seated(BEFORE_CUT, undefined, ancestry)).toBe(true)
	})

	it('keeps the seat on the session that cut once a successor owns the record', () => {
		expect(run_relay_seat.is_seated(HANDED_OFF, SEAT, ancestry)).toBe(true)
	})

	it('still seats the session while an expired budget may have lanes finishing', () => {
		expect(run_relay_seat.is_seated(read_of('expired', SUCCESSOR_PID), SEAT, ancestry)).toBe(true)
	})

	it('does not seat a session with no part in the run', () => {
		expect(run_relay_seat.is_seated(HANDED_OFF, undefined, ancestry)).toBe(false)
	})

	it('ignores a seat an earlier run left behind', () => {
		const stale: RelaySeat = { pid: ATTACHED_PID, started_at: EARLIER_RUN }

		expect(run_relay_seat.is_seated(HANDED_OFF, stale, ancestry)).toBe(false)
	})

	it('seats nobody once the run has ended', () => {
		expect(run_relay_seat.is_seated({ kind: 'none' }, SEAT, ancestry)).toBe(false)
	})
})
