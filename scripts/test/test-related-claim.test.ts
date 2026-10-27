import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_related_claim } from './test-related-claim'
import { unit_worker_share } from './unit-worker-share'

// The graph walk is `test-pinned-reach.probed.test.ts`; here only what the claim does with its count.
vi.mock('./test-pinned-reach', () => ({
	test_pinned_reach: { reached_test_count: vi.fn() },
}))

const FILES = ['scripts/test/test-related.ts']
const COMMAND_NAME = 'test:related'
// The narrowed scope joshuafolkken/kit#5135 measured.
const REACHED_TESTS = 69
const EXIT_CODE = 3

const mocked_reach = vi.mocked(test_pinned_reach.reached_test_count)

function claim(): ReadonlyArray<unknown> {
	return vi.mocked(core_budget.with_command_reservation).mock.calls[0] ?? []
}

async function run(): Promise<number> {
	return EXIT_CODE
}

// The claim runs its body without touching the machine-wide ledger, and no parent claim covers it;
// the live-run count is pinned so the share cannot move between the run and the assertion.
beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(unit_worker_share, 'live_run_count').mockReturnValue(0)
	vi.spyOn(core_budget, 'is_covered').mockReturnValue(false)
	vi.spyOn(core_budget, 'with_command_reservation').mockImplementation(
		async (_weight, body) => await body(),
	)
})

// joshuafolkken/kit#5135: a pass claims by the tests it reaches, where the command entry claimed the
// whole width for a 69-file scope as for the whole suite.
describe('test_related_claim.with_unit_claim', () => {
	it('claims a narrowed pass by the tests it reaches, as a unit claim', async () => {
		mocked_reach.mockResolvedValue(REACHED_TESTS)

		await expect(test_related_claim.with_unit_claim(FILES, run)).resolves.toBe(EXIT_CODE)

		const [weight, , options] = claim()

		expect(mocked_reach).toHaveBeenCalledWith(FILES)
		expect(weight).toBe(gate_plan.scoped_unit_weight(REACHED_TESTS))
		expect(options).toMatchObject({ command: COMMAND_NAME, is_unit: true })
	})

	it('claims the whole width where no graph counts the tests', async () => {
		mocked_reach.mockResolvedValue(undefined)

		await test_related_claim.with_unit_claim(FILES, run)

		expect(claim()[0]).toBe(gate_plan.direct_unit_weight())
	})

	it('claims the whole width for the whole suite, walking no graph', async () => {
		await test_related_claim.with_unit_claim(undefined, run)

		expect(claim()[0]).toBe(gate_plan.direct_unit_weight())
		expect(mocked_reach).not.toHaveBeenCalled()
	})

	it('sizes no claim where a parent claim covers the run', async () => {
		vi.mocked(core_budget.is_covered).mockReturnValueOnce(true)

		await expect(test_related_claim.with_unit_claim(FILES, run)).resolves.toBe(EXIT_CODE)

		expect(mocked_reach).not.toHaveBeenCalled()
		expect(core_budget.with_command_reservation).not.toHaveBeenCalled()
	})
})
