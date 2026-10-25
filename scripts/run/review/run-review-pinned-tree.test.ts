import { gate_tree } from '#scripts/gate/gate-tree'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_tree } from './run-review-pinned-tree'

// joshuafolkken/kit#4834: the launch's tree, as one digest `review:record` compares the fixed tree with.

const BASE = 'base-sha'
const A_FILE = 'a.ts'
const B_FILE = 'b.ts'
const FILES = { [A_FILE]: 'digest-a', [B_FILE]: 'digest-b' }

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_review_pinned_tree.digest_of', () => {
	it('reads the same tree as one digest whatever order git listed its files in', () => {
		const reordered = { [B_FILE]: 'digest-b', [A_FILE]: 'digest-a' }

		expect(run_review_pinned_tree.digest_of({ files: FILES, base: BASE })).toBe(
			run_review_pinned_tree.digest_of({ files: reordered, base: BASE }),
		)
	})

	it('reads a changed file or a moved base as another tree', () => {
		const digest = run_review_pinned_tree.digest_of({ files: FILES, base: BASE })
		const fixed = { ...FILES, [B_FILE]: 'digest-fixed' }

		expect(run_review_pinned_tree.digest_of({ files: fixed, base: BASE })).not.toBe(digest)
		expect(run_review_pinned_tree.digest_of({ files: FILES, base: 'other' })).not.toBe(digest)
	})

	it('answers no key for a reading git could not answer', () => {
		expect(run_review_pinned_tree.digest_of({ files: {}, base: BASE })).toBeUndefined()
		expect(run_review_pinned_tree.digest_of({ files: FILES, base: undefined })).toBeUndefined()
	})
})

describe('run_review_pinned_tree.key', () => {
	it('digests the tree the gate reads', async () => {
		vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: FILES, base: BASE })

		expect(await run_review_pinned_tree.key()).toBe(
			run_review_pinned_tree.digest_of({ files: FILES, base: BASE }),
		)
	})
})
