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
//
// joshuafolkken/kit#4313: that load held the first waiting claim too, so a solo gate's unit claim waited
// out the cap behind one core of Claude sessions. The first waiter is now held by the ledger alone, and a
// unit claim narrows to the room the outside load leaves; a claim queued behind another still waits.

const CORES = 11
const RESERVED = 9
const WAIT_CAP_MS = 10
const UNIT_WEIGHT = 2
const BLOCKER = `${core_budget.RESERVED_PREFIX}reserved.json`
const WAITER = `${core_budget.RESERVED_PREFIX}waiter.json`
// Claimed further back than the window a later claim may pass a waiter in, so the claim queues behind it.
const LONG_AGO = -60_000
const CPU_SATURATED_LINE = '⏳ a step waits for the core budget — CPU saturated'

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

// A one-core claim still waiting ahead of the next, claimed long enough ago that it is not passed.
function write_waiter_ahead(): void {
	const payload = { ...process_identity.own_fields(), weight: 1, claimed_at: LONG_AGO }

	writeFileSync(path.join(probe.directory, WAITER), JSON.stringify(payload))
}

// A claim on a machine read as `busy_cores`, its clock advanced past the wait cap by each sleep.
async function claim_one(
	read_machine: () => Promise<MachineReading>,
	weight = 1,
): Promise<{
	sleep: ReturnType<typeof vi.fn>
	report: ReturnType<typeof vi.fn>
	is_overflow: boolean
	granted: number | undefined
}> {
	const clock = { value: 1 }
	const sleep = vi.fn(async () => {
		clock.value += WAIT_CAP_MS
	})
	const report = vi.fn()
	const handle = await core_budget.reserve(weight, {
		directory: probe.directory,
		budget: CORES,
		read_machine,
		report,
		is_unit: true,
		wait_cap_ms: WAIT_CAP_MS,
		now: () => clock.value,
		sleep,
	})

	core_budget.release(handle)

	const { overflow, granted } = handle.admission

	return { sleep, report, is_overflow: overflow !== undefined, granted }
}

describe('core_budget.reserve — load outside the ledger does not hold the first waiter', () => {
	it('admits the first waiter at once on a saturated CPU when the reservations fit', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(CORES))

		expect(run.sleep).not.toHaveBeenCalled()
		expect(run.is_overflow).toBe(false)
	})

	// The outside load bounds the unit claim's workers instead of its start.
	it('narrows a unit claim to the room the outside load leaves', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(CORES), UNIT_WEIGHT)

		expect(run.sleep).not.toHaveBeenCalled()
		expect(run.granted).toBe(1)
	})

	it('admits a unit claim at full width when the busy cores are within the reservations', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(busy(RESERVED), UNIT_WEIGHT)

		expect(run.sleep).not.toHaveBeenCalled()
		expect(run.granted).toBeUndefined()
	})

	it('reads the machine and admits a claim alone in the ledger at once', async () => {
		const read_machine = vi.fn(busy(CORES + 1))

		const run = await claim_one(read_machine)

		expect(read_machine).toHaveBeenCalled()
		expect(run.sleep).not.toHaveBeenCalled()
	})
})

describe('core_budget.reserve — a saturated CPU holds a claim queued behind another', () => {
	it('waits when the busy cores exceed what the ledger reserves, though the reservations fit', async () => {
		write_reserved(RESERVED)
		write_waiter_ahead()

		const run = await claim_one(busy(CORES))

		expect(run.sleep).toHaveBeenCalled()
		expect(run.is_overflow).toBe(true)
	})

	it('names the saturated CPU as why it waits', async () => {
		write_reserved(RESERVED)
		write_waiter_ahead()

		const run = await claim_one(busy(CORES))

		expect(run.report).toHaveBeenCalledExactlyOnceWith(CPU_SATURATED_LINE)
	})

	it('admits the same claim at once when the busy cores are within the reservations', async () => {
		write_reserved(RESERVED)
		write_waiter_ahead()

		const run = await claim_one(busy(RESERVED))

		expect(run.sleep).not.toHaveBeenCalled()
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
		write_waiter_ahead()

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

// joshuafolkken/kit#4982: on a saturated machine a claim waited out the two-minute cap though the load
// never fell, then started at minimum width all the same. A wait whose load does not ease for a window
// now starts then; one whose load keeps falling still waits.
const STEP_MS = 300
const STEPS_TO_CAP = 10
const EASE_STEPS = 3
const FALL_PER_STEP = 3

// A held claim on a clock that each sleep steps by `STEP_MS`: how long it waited, and whether it
// started past the budget.
async function waited_ms(
	read_machine: () => Promise<MachineReading>,
	reserved = RESERVED,
): Promise<{
	waited: number
	is_overflow: boolean
}> {
	write_reserved(reserved)
	write_waiter_ahead()

	const clock = { value: 0 }
	const handle = await core_budget.reserve(1, {
		directory: probe.directory,
		budget: CORES,
		read_machine,
		report: vi.fn(),
		wait_cap_ms: STEP_MS * STEPS_TO_CAP,
		ease_window_ms: STEP_MS * EASE_STEPS,
		now: () => clock.value,
		sleep: async () => {
			clock.value += STEP_MS
		},
	})

	core_budget.release(handle)

	return { waited: clock.value, is_overflow: handle.admission.overflow !== undefined }
}

describe('core_budget.reserve — a wait that does not ease the load ends early', () => {
	it('admits at minimum width before the cap while the load holds steady', async () => {
		const run = await waited_ms(busy(CORES + 2))

		expect(run.is_overflow).toBe(true)
		expect(run.waited).toBe(STEP_MS * EASE_STEPS)
	})

	it('keeps waiting to the cap while the load keeps falling', async () => {
		const falling = Array.from(
			{ length: STEPS_TO_CAP + 1 },
			(_, step) => CORES + 2 + FALL_PER_STEP * (STEPS_TO_CAP - step),
		)
		const run = await waited_ms(busy_in_turn(falling))

		expect(run.is_overflow).toBe(true)
		expect(run.waited).toBe(STEP_MS * STEPS_TO_CAP)
	})

	// The ledger's own claims fill the machine and the reading is steady: their room comes back once
	// one ends, so the claim waits for it rather than starting narrow.
	it('keeps a claim the ledger holds waiting to the cap on a steady load', async () => {
		const run = await waited_ms(busy(CORES), CORES)

		expect(run.is_overflow).toBe(true)
		expect(run.waited).toBe(STEP_MS * STEPS_TO_CAP)
	})
})

// joshuafolkken/kit#4361: lanes took the machine to a load average of 25–34 on 11 cores while the first
// waiter ignored outside load. A run queue past twice the cores beyond the ledger now holds it, read
// afresh on every poll.
const OVERLOADED = RESERVED + CORES * 2 + 1

// Run-queue readings in turn on a saturated CPU, the last one repeated.
function queue_in_turn(run_queue: ReadonlyArray<number>): () => Promise<MachineReading> {
	let index = 0

	return async () => {
		const value = run_queue[Math.min(index, run_queue.length - 1)]

		index += 1

		return { busy_cores: CORES, available_mb: undefined, run_queue: value }
	}
}

describe('core_budget.reserve — an overloaded machine holds the first waiter', () => {
	it('keeps the first waiter waiting to the cap while the run queue stays past the cap', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(queue_in_turn([OVERLOADED]))

		expect(run.sleep).toHaveBeenCalled()
		expect(run.is_overflow).toBe(true)
	})

	it('names the saturated CPU as why the first waiter waits', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(queue_in_turn([OVERLOADED]))

		expect(run.report).toHaveBeenCalledExactlyOnceWith(CPU_SATURATED_LINE)
	})

	it('admits the first waiter once a later poll reads the queue back under the cap', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(queue_in_turn([OVERLOADED, RESERVED]))

		expect(run.sleep).toHaveBeenCalledOnce()
		expect(run.is_overflow).toBe(false)
	})

	// The oldest claim with nothing running used to start before the overload was consulted.
	it('keeps the oldest claim waiting on an empty ledger while the run queue stays past the cap', async () => {
		const run = await claim_one(queue_in_turn([OVERLOADED]))

		expect(run.sleep).toHaveBeenCalled()
		expect(run.is_overflow).toBe(true)
	})

	it('admits the first waiter at once with the queue at the cap', async () => {
		write_reserved(RESERVED)

		const run = await claim_one(queue_in_turn([OVERLOADED - 1]))

		expect(run.sleep).not.toHaveBeenCalled()
	})
})

describe('core_admission.is_admitted — a busy CPU does not hold the head', () => {
	// Busy cores say nothing about memory: a head whose cores fit still runs past a memory shortfall.
	it('keeps the head exempt from memory while the CPU is only partly busy', () => {
		const head = { key: 'only', reservation: { weight: 1, claimed_at: 1, memory_mb: 2400 } }
		const budget = { cores: CORES - 1, memory_mb: 500, busy_excess: 1 }

		expect(core_admission.is_admitted('only', [head], budget)).toBe(true)
	})
})
