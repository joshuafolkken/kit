import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { busy_average } from './busy-average'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#4167: vitest fixes its pool at start, so a unit claim narrowed off one busy instant
// ran narrow for the whole suite after the cores came back. A claim narrowed below half its asked
// width now waits for room until the wait cap.

const CORES = 11
const UNIT_WEIGHT = 7
const BLOCKER_WEIGHT = 4
// Seven cores of load outside the ledger leave the unit claim one core beside the blocker.
const SATURATED_BUSY = 11
// Three cores outside the ledger leave it four: half its width or more.
const HALF_ROOM_BUSY = 7
const HALF_ROOM = 4
const TOO_NARROW = 3
const WAIT_CAP_MS = 60_000
const BLOCKER = `${core_budget.RESERVED_PREFIX}blocker.json`

const probe = { directory: '' }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-unit-narrow-wait-test-'))

	const payload = {
		...process_identity.own_fields(),
		claimed_at: 0,
		admitted_at: 0,
		weight: BLOCKER_WEIGHT,
	}

	writeFileSync(path.join(probe.directory, BLOCKER), JSON.stringify(payload))
})

afterEach(() => {
	rmSync(probe.directory, { recursive: true, force: true })
})

function reading(busy_cores: number): MachineReading {
	return { busy_cores, available_mb: undefined }
}

// Each sleep moves the clock past the busy average's window, so every poll judges on its own reading.
async function reserve_unit(
	read_machine: () => Promise<MachineReading>,
	sleep: () => Promise<void>,
	clock: { now: number },
): ReturnType<typeof core_budget.reserve> {
	return await core_budget.reserve(UNIT_WEIGHT, {
		directory: probe.directory,
		budget: CORES,
		is_unit: true,
		read_machine,
		report: () => undefined,
		wait_cap_ms: WAIT_CAP_MS,
		now: () => clock.now,
		sleep,
	})
}

function advancing(clock: { now: number }, step_ms: number): () => Promise<void> {
	return vi.fn(async () => {
		clock.now += step_ms
	})
}

describe('core_admission.is_too_narrow', () => {
	const ledger = [
		{ key: 'own', reservation: { weight: UNIT_WEIGHT, claimed_at: 1, is_unit: true } },
	]

	it.each([
		['below half its width', TOO_NARROW, true],
		['at half its width or more', HALF_ROOM, false],
		['admitted as asked', undefined, false],
	])('reads a claim granted %s', (_case, granted, is_narrow) => {
		expect(core_admission.is_too_narrow('own', ledger, granted)).toBe(is_narrow)
	})
})

describe('core_budget.reserve — a unit claim narrowed off a busy instant', () => {
	it('waits, and past the cap is admitted narrow as an overflow', async () => {
		const clock = { now: 1 }
		const sleep = advancing(clock, WAIT_CAP_MS)
		const handle = await reserve_unit(async () => reading(SATURATED_BUSY), sleep, clock)

		expect(sleep).toHaveBeenCalled()
		expect(handle.admission.granted).toBe(1)
		expect(handle.admission.overflow).toBeDefined()
	})

	it('is admitted at full width before the cap once the load leaves', async () => {
		const clock = { now: 1 }
		// The load outside the ledger leaves after the first reading: only the blocker stays busy.
		const read_machine = vi
			.fn(async () => reading(BLOCKER_WEIGHT))
			.mockResolvedValueOnce(reading(SATURATED_BUSY))
		const handle = await reserve_unit(
			read_machine,
			advancing(clock, busy_average.AVERAGE_WINDOW_MS),
			clock,
		)

		expect(handle.admission.granted).toBeUndefined()
		expect(handle.admission.overflow).toBeUndefined()
	})

	it('starts at once where the room left is half its width or more', async () => {
		const clock = { now: 1 }
		const sleep = advancing(clock, WAIT_CAP_MS)
		const handle = await reserve_unit(async () => reading(HALF_ROOM_BUSY), sleep, clock)

		expect(sleep).not.toHaveBeenCalled()
		expect(handle.admission.granted).toBe(HALF_ROOM)
	})
})
