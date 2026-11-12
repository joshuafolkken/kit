import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gate_labels } from './gate-labels'
import type { GateTree } from './gate-tree'

const reusable_mock = vi.hoisted(() =>
	vi.fn<(labels: ReadonlyArray<string>) => Promise<ReadonlySet<string>>>(),
)

vi.mock('./check-reuse', () => ({ check_reuse: { reusable_checks: reusable_mock } }))
vi.mock('./project-checks', () => ({ project_checks: { is_kit_repository: () => true } }))

const { whole_tree_reuse } = await import('./whole-tree-reuse')

const TREE: GateTree = { files: {}, base: 'base' }

function records(label: string): string {
	return `records-${label}`
}

const { EXPORTS_LABEL, METRICS_LABEL } = gate_labels

beforeEach(() => {
	reusable_mock.mockReset().mockResolvedValue(new Set())
})

// joshuafolkken/kit#7030: a lane gate's green record leaves the whole-tree checks out, so a gate that
// must run them reuses it only with each one's own record green on the tree.
describe('whole_tree_reuse.is_reused', () => {
	it('reuses when every whole-tree check has a reusable record', async () => {
		reusable_mock.mockResolvedValue(new Set([EXPORTS_LABEL, METRICS_LABEL]))

		expect(await whole_tree_reuse.is_reused(TREE, records)).toBe(true)
		expect(reusable_mock).toHaveBeenCalledWith([EXPORTS_LABEL, METRICS_LABEL], TREE, records)
	})

	it('runs them when one of the whole-tree checks has no record', async () => {
		reusable_mock.mockResolvedValue(new Set([EXPORTS_LABEL]))

		expect(await whole_tree_reuse.is_reused(TREE, records)).toBe(false)
	})

	it('runs them when there are no records to read', async () => {
		expect(await whole_tree_reuse.is_reused(TREE, undefined)).toBe(false)
		expect(reusable_mock).not.toHaveBeenCalled()
	})
})
