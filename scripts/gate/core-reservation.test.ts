import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import { core_priority } from './core-priority'
import { core_reservation } from './core-reservation'

const CHILD_PID = 4242
const MEMORY_MB = 270
const ADMITTED_AT = 123
const TRANSFERRED_AT = 456
const CHILD_START = 'child-start'
const probe = { directory: '', target: '' }

const make_directory = temporary_directory()

beforeEach(() => {
	probe.directory = make_directory('josh-core-reservation-')
	probe.target = path.join(probe.directory, `${core_budget.RESERVED_PREFIX}child.json`)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('core_reservation.transfer', () => {
	it('keeps memory pending throughout installation and starts its ramp only on child transfer', () => {
		core_reservation.write_reservation(probe.target, {
			weight: 0,
			claimed_at: 1,
			admitted_at: ADMITTED_AT,
			memory_mb: MEMORY_MB,
			is_memory_pending: true,
		})
		const now = ADMITTED_AT + core_admission.RAMP_UP_MS

		expect(
			core_admission.ledger_load(core_budget.live_reservations(probe.directory), now).memory_mb,
		).toBe(0)
		vi.spyOn(Date, 'now').mockReturnValue(now)
		core_reservation.transfer({ target: probe.target }, process.pid)
		expect(
			core_admission.ledger_load(
				core_budget.live_reservations(probe.directory),
				now + core_admission.RAMP_UP_MS,
			).memory_mb,
		).toBe(MEMORY_MB)
	})
})

// joshuafolkken/kit#5767: a ship's closing stages mark their children's claims as priority.
describe('core_reservation.claim_fields — the priority mark', () => {
	it('marks the claim priority under the environment mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '1')

		expect(core_reservation.claim_fields(1, 1, {}).is_priority).toBe(true)
	})

	it('leaves the field out without the mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '')

		expect(core_reservation.claim_fields(1, 1, {}).is_priority).toBeUndefined()
	})

	it('leaves the field out of a unit-suite claim under the mark', () => {
		vi.stubEnv(core_priority.PRIORITY_KEY, '1')

		expect(core_reservation.claim_fields(1, 1, { is_unit: true }).is_priority).toBeUndefined()
	})
})

describe('core_reservation.transfer — ownership', () => {
	it('preserves the memory and restarts its ramp-up window for the new process owner', () => {
		core_reservation.write_reservation(probe.target, {
			weight: 0,
			claimed_at: 1,
			admitted_at: ADMITTED_AT,
			memory_mb: MEMORY_MB,
		})
		vi.spyOn(process_identity, 'read_start').mockReturnValue(CHILD_START)
		vi.spyOn(Date, 'now').mockReturnValue(TRANSFERRED_AT)
		core_budget.transfer({ target: probe.target }, CHILD_PID)

		expect(core_reservation.read_reservation(probe.target)).toMatchObject({
			pid: CHILD_PID,
			process_start: CHILD_START,
			memory_mb: MEMORY_MB,
			admitted_at: TRANSFERRED_AT,
		})
	})

	it('allows the existing liveness sweep to reclaim a finished child claim', () => {
		core_reservation.write_reservation(probe.target, { weight: 0, claimed_at: 1 })
		core_reservation.transfer({ target: probe.target }, CHILD_PID)
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)

		expect(core_budget.live_reservations(probe.directory)).toEqual([])
		expect(core_reservation.read_reservation(probe.target)).toBeUndefined()
	})
})
