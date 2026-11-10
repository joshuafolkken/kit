import { beforeEach, describe, expect, it, vi } from 'vitest'

const reusable_mock = vi.hoisted(() => vi.fn<() => object | undefined>())
const whole_tree_mock = vi.hoisted(() => vi.fn(async () => true))

vi.mock('#scripts/gate/gate-tree', () => ({
	gate_tree: { read_gate_tree: async () => ({ files: {}, base: 'base' }) },
}))
vi.mock('#scripts/gate/gate-skip', () => ({ gate_skip: { reusable_green_gate: reusable_mock } }))
vi.mock('#scripts/gate/whole-tree-reuse', () => ({
	whole_tree_reuse: { WHOLE_TREE_FLAG: '--whole-tree', is_reused: whole_tree_mock },
}))

const { run_ship_scoped } = await import('./run-ship-scoped')

beforeEach(() => {
	reusable_mock.mockReset().mockReturnValue(undefined)
	whole_tree_mock.mockReset().mockResolvedValue(true)
})

// joshuafolkken/kit#3643: the gate's own reuse test decides whether a gate stage only reused a record.
describe('run_ship_scoped.is_gate_green', () => {
	it('is green when the gate holds a reusable record for this tree', async () => {
		reusable_mock.mockReturnValue({})

		expect(await run_ship_scoped.is_gate_green()).toBe(true)
		expect(reusable_mock).toHaveBeenCalledWith({}, 'base')
	})

	it('is not green when no record matches the tree', async () => {
		expect(await run_ship_scoped.is_gate_green()).toBe(false)
	})

	// joshuafolkken/kit#7030: a lane gate's green record leaves the whole-tree checks out, so the
	// ship's gate runs them unless their own records are green on this tree.
	it('is not green when the whole-tree checks have no record for the tree', async () => {
		reusable_mock.mockReturnValue({})
		whole_tree_mock.mockResolvedValue(false)

		expect(await run_ship_scoped.is_gate_green()).toBe(false)
	})
})
