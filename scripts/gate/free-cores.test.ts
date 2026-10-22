import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unit_worker_share } from '#scripts/test/unit-worker-share'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { core_budget } from './core-budget'
import { core_weights } from './core-weights'
import { free_cores } from './free-cores'
import type { MachineReading } from './machine-capacity'

// joshuafolkken/kit#3945: the unit suite's worker count is bounded by what the machine has free, the
// core count less the load from outside the core budget's ledger.

const CORES = 11
const UNREAD: MachineReading = { busy_cores: undefined, available_mb: undefined }
const LEDGER_WEIGHT = 4
// The ledger's claim and five cores from outside it.
const OUTSIDE_LOAD = 5
const BUSY_CORES = LEDGER_WEIGHT + OUTSIDE_LOAD
const MEMORY_WORKERS = 3
const AVAILABLE_MB = MEMORY_WORKERS * core_weights.MEMORY_MB.unit_worker

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

		expect(free).toStrictEqual({ cores: undefined, memory_workers: undefined })
	})

	it('subtracts the busy cores no ledger claim accounts for', async () => {
		const free = await free_cores.read({
			available_cores: CORES,
			read_machine: reading_of(OUTSIDE_LOAD),
			directory: ctx.directory,
		})

		expect(free.cores).toBe(CORES - OUTSIDE_LOAD)
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

		expect(free.cores).toBe(CORES - OUTSIDE_LOAD)
	})
})

// joshuafolkken/kit#4528: the same reading carries the memory the share is bounded by.
describe('free_cores.read — the workers the free memory holds', () => {
	it('divides the available memory by one worker’s peak', async () => {
		const free = await free_cores.read({
			available_cores: CORES,
			read_machine: async () => ({ busy_cores: OUTSIDE_LOAD, available_mb: AVAILABLE_MB }),
			directory: ctx.directory,
		})

		expect(free).toStrictEqual({ cores: CORES - OUTSIDE_LOAD, memory_workers: MEMORY_WORKERS })
	})

	it('answers no memory bound where the memory could not be read', async () => {
		const free = await free_cores.read({
			available_cores: CORES,
			read_machine: reading_of(OUTSIDE_LOAD),
			directory: ctx.directory,
		})

		expect(free.memory_workers).toBeUndefined()
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

		expect(free.cores).toBe(CORES - OUTSIDE_LOAD)
	})
})
