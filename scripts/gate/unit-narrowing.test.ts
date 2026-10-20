import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import { gate_plan } from './gate-plan'
import type { GateStep } from './gate-report'
import { UNIT_WORKER_FLAG, with_granted_workers } from './gate-steps'
import { held_mark } from './held-mark'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#4235: a unit claim admitted past the wait cap took its full width, and the ledger
// held more than the machine. It is now admitted at the room the admitted claims leave.

const CORES = 11
const BLOCKER_WEIGHT = 8
const UNIT_WEIGHT = 7
const NARROWED = 3
const WAIT_CAP_MS = 1000
const BLOCKER = `${core_budget.RESERVED_PREFIX}blocker.json`
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const { UNIT_LABEL } = gate_plan

const probe = { directory: '' }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-unit-narrowing-test-'))
})

afterEach(() => {
	vi.unstubAllEnvs()
	rmSync(probe.directory, { recursive: true, force: true })
})

function write_blocker(weight: number): void {
	const payload = { ...process_identity.own_fields(), claimed_at: 0, admitted_at: 0, weight }

	writeFileSync(path.join(probe.directory, BLOCKER), JSON.stringify(payload))
}

// The blocker never leaves, so the claim waits until the clock passes the wait cap.
async function reserve_past_cap(is_unit: boolean): ReturnType<typeof core_budget.reserve> {
	const clock = { now: 1 }

	return await core_budget.reserve(UNIT_WEIGHT, {
		directory: probe.directory,
		budget: CORES,
		is_unit,
		read_machine: async () => UNREAD,
		report: () => undefined,
		wait_cap_ms: WAIT_CAP_MS,
		now: () => clock.now,
		sleep: async () => {
			clock.now += WAIT_CAP_MS
		},
	})
}

function unit_step(command_args: Array<string>, label: string = UNIT_LABEL): GateStep {
	return { label, command_args, cwd: undefined }
}

describe('core_budget.reserve — a unit claim past the wait cap', () => {
	it('is admitted at the room the admitted claims leave', async () => {
		write_blocker(BLOCKER_WEIGHT)
		const handle = await reserve_past_cap(true)
		const ledger = core_budget.live_reservations(probe.directory)

		expect(handle.admission.granted).toBe(NARROWED)
		expect(JSON.parse(readFileSync(handle.target, 'utf8'))).toMatchObject({
			is_unit: true,
			granted: NARROWED,
		})
		expect(core_admission.admitted_load(ledger, CORES)).toBe(CORES)
	})

	it('reports the ledger it was admitted into at the narrowed weight, not the asked one', async () => {
		write_blocker(BLOCKER_WEIGHT)
		const handle = await reserve_past_cap(true)

		expect(handle.admission.overflow?.ledger.cores).toBe(BLOCKER_WEIGHT + NARROWED)
	})

	it('leaves any other claim at its full width, reported as an overflow', async () => {
		write_blocker(BLOCKER_WEIGHT)
		const handle = await reserve_past_cap(false)

		expect(handle.admission.granted).toBeUndefined()
		expect(handle.admission.overflow).toBeDefined()
	})

	it('still runs one worker when the admitted claims fill the machine', async () => {
		write_blocker(CORES)
		const handle = await reserve_past_cap(true)

		expect(handle.admission.granted).toBe(1)
	})
})

describe('core_admission.narrowed_weight', () => {
	it('leaves a unit claim that fits as asked', () => {
		const ledger = [
			{ key: 'own', reservation: { weight: NARROWED, claimed_at: 1, is_unit: true } },
			{ key: 'other', reservation: { weight: BLOCKER_WEIGHT, claimed_at: 0, admitted_at: 0 } },
		]

		expect(core_admission.narrowed_weight('own', ledger, CORES)).toBeUndefined()
	})
})

describe('with_granted_workers', () => {
	it('replaces the unit step worker flag with the granted count', () => {
		const step = with_granted_workers(unit_step(['josh', 'test:unit', `${UNIT_WORKER_FLAG}=7`]), 2)

		expect(step.command_args).toStrictEqual(['josh', 'test:unit', `${UNIT_WORKER_FLAG}=2`])
	})

	it('adds the flag to a unit step that had none', () => {
		const step = with_granted_workers(unit_step(['josh', 'test:unit']), 2)

		expect(step.command_args).toStrictEqual(['josh', 'test:unit', `${UNIT_WORKER_FLAG}=2`])
	})

	it('leaves a step admitted as asked, or one that is not the unit step', () => {
		const unit = unit_step(['josh', 'test:unit'])
		const lint = unit_step(['josh', 'lint'], 'lint')

		expect(with_granted_workers(unit, undefined)).toBe(unit)
		expect(with_granted_workers(lint, 2)).toBe(lint)
	})
})

describe('core_budget.held_unit_claim', () => {
	it.each([
		['a unit claim this process holds', true, true],
		['a held claim that is not a unit suite', false, false],
	])('reads %s', async (_case, is_unit, is_found) => {
		const handle = await reserve_past_cap(is_unit)

		vi.stubEnv(held_mark.HELD_RESERVATION_KEY, path.basename(handle.target))

		expect(core_budget.held_unit_claim(probe.directory) !== undefined).toBe(is_found)
	})

	it('reads nothing where this process holds no claim', async () => {
		await reserve_past_cap(true)
		vi.stubEnv(held_mark.HELD_RESERVATION_KEY, '')

		expect(core_budget.held_unit_claim(probe.directory)).toBeUndefined()
	})
})
