import { randomUUID } from 'node:crypto'
import type { GateTree } from '#scripts/gate/gate-tree'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { afterEach, describe, expect, it } from 'vitest'
import { run_ship_tree_stamp } from './run-ship-tree-stamp'

const TREE: GateTree = { base: 'base-sha', files: { 'a.ts': 'digest-a' } }
const STAMP = file_map_stamp.create(`josh-ship-tree-stamp-test-${randomUUID()}-`)
const FAILED = 1

afterEach(() => {
	STAMP.remove()
})

describe('run_ship_tree_stamp', () => {
	it('reuses a completed pass on the same tree and base', () => {
		run_ship_tree_stamp.complete(STAMP, TREE, 0)

		expect(run_ship_tree_stamp.is_reusable(STAMP, TREE)).toBe(true)
	})

	it.each<GateTree>([
		{ base: 'base-sha', files: { 'a.ts': 'digest-b' } },
		{ base: 'moved-base', files: { 'a.ts': 'digest-a' } },
		{ base: 'base-sha', files: {} },
	])('does not reuse it on a moved or empty tree: %j', (moved) => {
		run_ship_tree_stamp.complete(STAMP, TREE, 0)

		expect(run_ship_tree_stamp.is_reusable(STAMP, moved)).toBe(false)
	})

	it('records nothing for a failed stage', () => {
		run_ship_tree_stamp.complete(STAMP, TREE, FAILED)

		expect(run_ship_tree_stamp.is_reusable(STAMP, TREE)).toBe(false)
	})

	it('does not reuse a stamp written but never completed', () => {
		STAMP.write(TREE.files, undefined, TREE.base)

		expect(run_ship_tree_stamp.is_reusable(STAMP, TREE)).toBe(false)
	})
})
