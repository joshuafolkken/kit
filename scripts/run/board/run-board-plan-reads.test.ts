import type { OpenListing } from '#scripts/backlog/backlog-plan-read'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_plan, type PlanPorts } from './run-board-plan'

// joshuafolkken/kit#8220: the open listing and the opted-in pool are read side by side, and the listing
// is handed to the classification so the epics are not read a second time.

const { read_plan } = run_board_plan
const POOL_ONLY = { issues: [], only: false }
const LISTING: OpenListing = {
	rows: [{ number: 1, title: 'One', createdAt: '2026-10-01T00:00:00Z' }],
	is_capped: false,
}
const POOL = { kind: 'read' as const, issues: [], cutoff: 'none' as const }

function ports(overrides: Partial<PlanPorts> = {}): PlanPorts {
	return {
		fetch_open: vi.fn(async () => LISTING),
		fetch_opted_in: vi.fn(async () => POOL),
		fetch_relations: vi.fn(async () => undefined),
		classify: vi.fn(async () => undefined),
		...overrides,
	}
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_board_plan.read_plan reads', () => {
	it('starts the pool read before the open listing has answered', async () => {
		const read = ports({ fetch_open: vi.fn(async () => await new Promise<never>(() => undefined)) })

		void read_plan(POOL_ONLY, read)

		await vi.waitFor(() => {
			expect(read.fetch_opted_in).toHaveBeenCalledOnce()
		})
	})

	it('hands the classification the open listing it read', async () => {
		const read = ports()

		await read_plan(POOL_ONLY, read)

		expect(read.classify).toHaveBeenCalledWith(POOL, [], LISTING)
	})

	it('draws no plan and classifies nothing when the pool read fails', async () => {
		const read = ports({
			fetch_opted_in: vi.fn(async () => ({ kind: 'blockers_unreadable' as const })),
		})

		await expect(read_plan(POOL_ONLY, read)).resolves.toBeUndefined()

		expect(read.classify).not.toHaveBeenCalled()
	})
})
