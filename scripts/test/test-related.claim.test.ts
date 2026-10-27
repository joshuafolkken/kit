import path from 'node:path'
import { core_budget } from '#scripts/gate/core-budget'
import { gate_plan } from '#scripts/gate/gate-plan'
import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { test_pinned_reach } from './test-pinned-reach'
import { test_read_map } from './test-read-map'
import { test_related } from './test-related'
import { test_unit_guard } from './test-unit-guard'

vi.mock('#scripts/git/git-command', () => ({ git_command: { repository_root: vi.fn() } }))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: {
		read_changed_paths: vi.fn(),
		read_changed_since: vi.fn(),
		read_held_at: vi.fn(),
	},
}))
vi.mock('./test-unit-guard', () => ({
	test_unit_guard: { is_running: vi.fn(), run_guarded_vitest: vi.fn() },
}))
// Mocked for the reason `test-related.test.ts` gives: the real one writes this checkout's record.
vi.mock('#scripts/gate/scoped-green', () => ({
	scoped_green: { read_before: vi.fn(), record_if_green: vi.fn() },
}))
vi.mock('#scripts/gate/since-green', () => ({ since_green: { read_moved_parts: vi.fn() } }))
// The graph walk is `test-pinned-reach.probed.test.ts`; here only what the claim does with its count.
vi.mock('./test-pinned-reach', () => ({
	test_pinned_reach: { reached_test_count: vi.fn() },
}))

const REPOSITORY_ROOT = process.cwd()
const CHANGED_SOURCE = path.join('scripts', 'test', 'test-related.ts')
const ABSOLUTE_SOURCE = path.join(REPOSITORY_ROOT, CHANGED_SOURCE)
const COMMAND_NAME = 'test:related'
// The narrowed scope joshuafolkken/kit#5135 measured.
const REACHED_TESTS = 69

const mocked_reach = vi.mocked(test_pinned_reach.reached_test_count)

function claim(): ReadonlyArray<unknown> {
	return vi.mocked(core_budget.with_command_reservation).mock.calls[0] ?? []
}

// The claim runs its body without touching the machine-wide ledger, and no parent claim covers it.
function stub_claim(): void {
	vi.spyOn(core_budget, 'is_covered').mockReturnValue(false)
	vi.spyOn(core_budget, 'with_command_reservation').mockImplementation(
		async (_weight, run) => await run(),
	)
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
	vi.mocked(git_command.repository_root).mockResolvedValue(REPOSITORY_ROOT)
	vi.mocked(changed_paths.read_changed_paths).mockResolvedValue([CHANGED_SOURCE])
	vi.mocked(changed_paths.read_changed_since).mockResolvedValue([])
	vi.mocked(changed_paths.read_held_at).mockResolvedValue([])
	vi.mocked(test_unit_guard.run_guarded_vitest).mockResolvedValue(0)
	vi.mocked(test_unit_guard.is_running).mockReturnValue(true)
	vi.spyOn(test_read_map, 'read_map').mockReturnValue(undefined)
	stub_claim()
})

// joshuafolkken/kit#5135: the claim is taken once the scope is known, sized by the tests it reaches,
// where the command entry claimed the whole width for a 69-file scope as for the whole suite.
describe('test_related.run_related_tests — the cores it claims', () => {
	it('claims a narrowed scope by the tests it reaches, as a unit claim', async () => {
		mocked_reach.mockResolvedValue(REACHED_TESTS)

		await test_related.run_related_tests([])

		const [weight, , options] = claim()

		expect(mocked_reach).toHaveBeenCalledWith([ABSOLUTE_SOURCE])
		expect(weight).toBe(gate_plan.scoped_unit_weight(REACHED_TESTS))
		expect(options).toMatchObject({ command: COMMAND_NAME, is_unit: true })
	})

	it('claims the whole width where no graph counts the tests', async () => {
		mocked_reach.mockResolvedValue(undefined)

		await test_related.run_related_tests([])

		expect(claim()[0]).toBe(gate_plan.direct_unit_weight())
	})

	it('claims the whole width for the whole suite, walking no graph', async () => {
		vi.mocked(changed_paths.read_changed_paths).mockRejectedValue(new Error('not a git repository'))

		await test_related.run_related_tests([])

		expect(claim()[0]).toBe(gate_plan.direct_unit_weight())
		expect(mocked_reach).not.toHaveBeenCalled()
	})

	it('sizes no claim where a parent claim covers the run', async () => {
		vi.mocked(core_budget.is_covered).mockReturnValueOnce(true)

		await expect(test_related.run_related_tests([])).resolves.toBe(0)

		expect(mocked_reach).not.toHaveBeenCalled()
		expect(core_budget.with_command_reservation).not.toHaveBeenCalled()
	})
})
