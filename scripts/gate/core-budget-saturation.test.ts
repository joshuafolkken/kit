import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { process_identity } from '#scripts/josh/process-identity'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_admission } from './core-admission'
import { core_budget } from './core-budget'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#4238: with 10 cores reserved and all 11 of the machine's cores busy, the budget
// exempted a two-core baseline and saw no excess, so the next claim was admitted onto a saturated CPU;
// and a claim alone in the ledger never read the machine at all. Free cores are now
// `cores − max(reserved, busy)`, read for every claim.

const CORES = 11
const RESERVED = 10
const WAIT_CAP_MS = 10
const BLOCKER = `${core_budget.RESERVED_PREFIX}reserved.json`

const probe = { directory: '' }

beforeEach(() => {
	probe.directory = mkdtempSync(path.join(tmpdir(), 'josh-core-budget-saturation-test-'))
})

afterEach(() => {
	rmSync(probe.directory, { recursive: true, force: true })
})

function busy(busy_cores: number): () => Promise<MachineReading> {
	return async () => ({ busy_cores, available_mb: undefined })
}

function write_reserved(weight: number): void {
	const payload = { ...process_identity.own_fields(), weight, claimed_at: 0, admitted_at: 0 }

	writeFileSync(path.join(probe.directory, BLOCKER), JSON.stringify(payload))
}

// A one-core claim on a machine read as `busy_cores`, its clock advanced past the wait cap by each sleep.
async function claim_one(read_machine: () => Promise<MachineReading>): Promise<{
	sleep: ReturnType<typeof vi.fn>
	report: ReturnType<typeof vi.fn>
	is_overflow: boolean
}> {
	const clock = { value: 1 }
	const sleep = vi.fn(async () => {
		clock.value += WAIT_CAP_MS
	})
	const report = vi.fn()
	const handle = await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		read_machine,
		report,
		wait_cap_ms: WAIT_CAP_MS,
		now: () => clock.value,
		sleep,
	})

	core_budget.release(handle)

	return { sleep, report, is_overflow: handle.admission.overflow !== undefined }
}

describe('core_budget.reserve — a saturated CPU holds a new claim', () => {
	it('waits when the busy cores exceed what the ledger reserves, though the reservations fit', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(CORES))

		expect(run.sleep).toHaveBeenCalled()
		expect(run.is_overflow).toBe(true)
	})

	it('names the saturated CPU as why it waits', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(CORES))

		expect(run.report).toHaveBeenCalledExactlyOnceWith(
			'⏳ a step waits for the core budget — CPU saturated',
		)
	})

	it('admits the same claim at once when the busy cores are within the reservations', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(RESERVED))

		expect(run.sleep).not.toHaveBeenCalled()
	})

	it('reads the machine and waits for a claim alone in the ledger', async () => {
		const read_machine = vi.fn(busy(CORES + 1))

		const run = await claim_one(read_machine)

		expect(read_machine).toHaveBeenCalled()
		expect(run.is_overflow).toBe(true)
	})

	it('admits a claim alone in the ledger at once on a machine with room', async () => {
		const run = await claim_one(busy(1))

		expect(run.sleep).not.toHaveBeenCalled()
		expect(run.report).not.toHaveBeenCalled()
	})
})

// Readings of `busy_cores` in turn, the last one repeated.
function busy_in_turn(busy_cores: ReadonlyArray<number>): () => Promise<MachineReading> {
	let index = 0

	return async () => {
		const value = busy_cores[Math.min(index, busy_cores.length - 1)]

		index += 1

		return { busy_cores: value, available_mb: undefined }
	}
}

describe('core_budget.reserve — a waiting claim admits against its recent readings', () => {
	const STEP_MS = 300
	const STEPS_TO_CAP = 5

	// Three readings three cores past the ledger, then a dip: one reading alone would admit at the dip,
	// the mean holds the claim until the wait cap.
	it('keeps waiting through a momentary dip in a saturated CPU', async () => {
		write_reserved(RESERVED)

		const clock = { value: 1 }
		const handle = await core_budget.reserve(1, {
			directory: probe.directory,
			budget: CORES,
			read_machine: busy_in_turn([CORES + 2, CORES + 2, CORES + 2, RESERVED]),
			report: vi.fn(),
			wait_cap_ms: STEP_MS * STEPS_TO_CAP,
			now: () => clock.value,
			sleep: async () => {
				clock.value += STEP_MS
			},
		})

		core_budget.release(handle)

		expect(handle.admission.overflow).toBeDefined()
	})
})

describe('core_admission.is_admitted — a busy CPU holds the head on cores only', () => {
	// Busy cores say nothing about memory: a head whose cores fit still runs past a memory shortfall.
	it('keeps the head exempt from memory while the CPU is only partly busy', () => {
		const head = { key: 'only', reservation: { weight: 1, claimed_at: 1, memory_mb: 2400 } }
		const budget = { cores: CORES - 1, memory_mb: 500, busy_excess: 1 }

		expect(core_admission.is_admitted('only', [head], budget)).toBe(true)
	})
})
