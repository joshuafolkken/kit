import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget } from './core-budget'
import { free_cores } from './free-cores'
import { gate_plan } from './gate-plan'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#3945: the unit suite's worker count is bounded by what the machine has free, the
// core count less the load from outside the core budget's ledger.

const CORES = 11
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const LEDGER_WEIGHT = 4
// The ledger's claim and five cores from outside it.
const OUTSIDE_LOAD = 5
const BUSY_CORES = LEDGER_WEIGHT + OUTSIDE_LOAD
const SCARCE_FREE = 3
const PAIRED_RUNS = 2

const ctx = { directory: '' }

function reading_of(busy_cores: number | undefined): () => Promise<MachineReading> {
	return async () => ({ ...UNREAD, busy_cores })
}

beforeEach(() => {
	ctx.directory = mkdtempSync(path.join(tmpdir(), 'free-cores-'))
})

afterEach(() => {
	rmSync(ctx.directory, { recursive: true, force: true })
})

describe('free_cores.read', () => {
	it('answers undefined where the machine could not be read', async () => {
		const free = await free_cores.read({
			available_cores: CORES,
			read_machine: reading_of(undefined),
			directory: ctx.directory,
		})

		expect(free).toBeUndefined()
	})

	it('subtracts the busy cores no ledger claim accounts for', async () => {
		const free = await free_cores.read({
			available_cores: CORES,
			read_machine: reading_of(OUTSIDE_LOAD),
			directory: ctx.directory,
		})

		expect(free).toBe(CORES - OUTSIDE_LOAD)
	})

	// Another run's admitted claim is load already divided between the runs; only the rest is subtracted.
	it("leaves another run's admitted claim out of the subtraction", async () => {
		const free = await core_budget.with_core_reservation(
			LEDGER_WEIGHT,
			async () =>
				await free_cores.read({
					available_cores: CORES,
					read_machine: reading_of(BUSY_CORES),
					directory: ctx.directory,
				}),
			{ directory: ctx.directory, read_machine: reading_of(undefined) },
		)

		expect(free).toBe(CORES - OUTSIDE_LOAD)
	})
})

// The order `josh test:unit` runs in: the command's claim is admitted, then the guard reads the machine
// before it starts a worker, so the claim's weight is not yet in the reading. The held mark is cleared
// first, because this suite itself runs under a `josh test:unit` that holds one.
describe('free_cores.read — inside the claim its own command holds', () => {
	beforeEach(() => {
		vi.stubEnv(core_budget.HELD_KEY, '')
		vi.stubEnv(unit_worker_share.NESTED_KEY, '')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('does not let its own not-yet-busy claim mask the outside load', async () => {
		const free = await core_budget.with_command_reservation(
			LEDGER_WEIGHT,
			async () =>
				await free_cores.read({
					available_cores: CORES,
					read_machine: reading_of(OUTSIDE_LOAD),
					directory: ctx.directory,
				}),
			{ directory: ctx.directory, budget: CORES, read_machine: reading_of(undefined) },
		)

		expect(free).toBe(CORES - OUTSIDE_LOAD)
	})
})

describe('gate_plan.bound_by_free — the gate unit cap', () => {
	it('takes the free cores when they are fewer than the cap', () => {
		const plan = gate_plan.resolve_gate_plan(CORES, PAIRED_RUNS)

		expect(gate_plan.bound_by_free(plan, CORES, SCARCE_FREE).unit_worker_cap).toBe(SCARCE_FREE)
	})

	it('keeps the cap where the machine could not be read', () => {
		const plan = gate_plan.resolve_gate_plan(CORES)

		expect(gate_plan.bound_by_free(plan, CORES, undefined)).toEqual(plan)
	})

	it('adds no cap to a plan without the unit suite', () => {
		const plan = gate_plan.resolve_gate_plan(CORES, 1, false)

		expect(gate_plan.bound_by_free(plan, CORES, SCARCE_FREE).unit_worker_cap).toBeUndefined()
	})
})
