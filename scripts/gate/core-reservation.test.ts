import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import { core_reservation } from './core-reservation'

const CHILD_PID = 4242
const MEMORY_MB = 270
const ADMITTED_AT = 123
const TRANSFERRED_AT = 456
const CHILD_START = 'child-start'
const probe = { directory: '', target: '' }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-core-reservation-'))
	probe.target = path.join(probe.directory, `${core_budget.RESERVED_PREFIX}child.json`)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(probe.directory, { recursive: true, force: true })
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
