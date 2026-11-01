import { process_identity_fixture } from '#scripts/josh/process-identity-fixture'
import { describe, expect, it } from 'vitest'
import { run_carry, type CarryOwner, type RunCarry } from './run-carry'

// joshuafolkken/kit#3701: the wake supervisor read a record its own driver had adopted as a session at
// work, and waited on itself.

const STARTED_AT = '2026-10-12T00:00:00.000Z'

function owned_by(owner: CarryOwner): RunCarry {
	return {
		invocation: 'backlogrun --max 5',
		started_at: STARTED_AT,
		merged: 0,
		filed: 0,
		cuts: 0,
		failures: 0,
		outages: 0,
		owner_pid: owner.pid,
		owner_start: owner.start,
	}
}

function gone(): RunCarry {
	return owned_by(run_carry.owner_of(process_identity_fixture.DEAD_PID))
}

describe('run_carry.is_held_by_another', () => {
	it('does not read a record the calling process owns as held by another', () => {
		const own = owned_by(run_carry.owner_of(process.pid))

		expect(run_carry.is_owner_live(own)).toBe(true)
		expect(run_carry.is_held_by_another(own)).toBe(false)
	})

	it('reads a record another live process owns as held', () => {
		const other = owned_by(run_carry.owner_of(process.ppid))

		expect(run_carry.is_held_by_another(other)).toBe(true)
	})

	it('does not read a record whose owner is gone as held', () => {
		expect(run_carry.is_held_by_another(gone())).toBe(false)
	})

	it('asks the liveness it is handed', () => {
		expect(run_carry.is_held_by_another(gone(), () => true)).toBe(true)
	})
})

// joshuafolkken/kit#5743: no wake prints the adoption command any more, so the refusal is its one reader.
describe('run_carry.standing_message', () => {
	it('names the adoption command for a record whose owner is gone', () => {
		const message = run_carry.standing_message(gone())

		expect(message).toContain('`pnpm josh run:carry --resume "backlogrun --max 5"`')
	})
})
