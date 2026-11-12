import { core_budget } from '#scripts/gate/core-budget'
import { machine_capacity } from '#scripts/gate/machine-capacity'
import { temporary_directory } from '#tools/test/temporary-directory'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const make_directory = temporary_directory()

// joshuafolkken/kit#3415: the machine guard is a worker setup file, so this suite runs under it exactly
// as every gate suite does — what it reads here is what they read.
vi.mock('execa', () => ({ execa: vi.fn() }))

const mocked_execa = vi.mocked(execa)
const BUDGET = 4

describe('the unit suite never reads the machine it runs on', () => {
	let directory: string

	beforeEach(() => {
		directory = make_directory('machine-guard-')
	})

	afterEach(() => {
		mocked_execa.mockClear()
	})

	it('answers a reading where nothing could be read', async () => {
		await expect(machine_capacity.read_machine()).resolves.toEqual({
			busy_cores: undefined,
			available_mb: undefined,
		})
	})

	it('spawns nothing to read the memory pressure', async () => {
		await machine_capacity.read_machine()

		expect(mocked_execa).not.toHaveBeenCalled()
	})

	// A claim alone in the ledger reads nothing, so a second one is held beside it to reach the reading.
	it('admits a reservation by the budget alone, as a CI runner does', async () => {
		const held = await core_budget.reserve(1, { budget: BUDGET, directory })
		const handle = await core_budget.reserve(1, { budget: BUDGET, directory })

		core_budget.release(handle)
		core_budget.release(held)

		expect(handle.admission.overflow).toBeUndefined()
		expect(mocked_execa).not.toHaveBeenCalled()
	})

	it('leaves the reading arithmetic the real one', () => {
		expect(machine_capacity.parse_linux_available('MemAvailable:    2048 kB\n')).toBe(2)
	})
})
