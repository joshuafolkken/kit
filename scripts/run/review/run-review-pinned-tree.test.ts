import { gate_tree } from '#scripts/gate/gate-tree'
import { OBSERVATION_LEDGER_DIRECTORY } from '#scripts/observations/observation-ledger'
import { release_approval_prune } from '#scripts/release/release-approval-prune'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_tree } from './run-review-pinned-tree'

// joshuafolkken/kit#4834: the launch's tree, as one digest `review:record` compares the fixed tree with.

const BASE = 'base-sha'
const A_FILE = 'a.ts'
const B_FILE = 'b.ts'
const FILES = { [A_FILE]: 'digest-a', [B_FILE]: 'digest-b' }
const OBSERVATION_FILE = `${OBSERVATION_LEDGER_DIRECTORY}/5002.md`
const APPROVAL_FILE = `${release_approval_prune.APPROVAL_DIRECTORY}/approval.json`
const OBSERVATION = { [OBSERVATION_FILE]: 'digest-observation' }
const APPROVAL = { [APPROVAL_FILE]: 'digest-approval' }
const RECORDED = { ...FILES, ...OBSERVATION }

afterEach(() => {
	vi.restoreAllMocks()
})

async function key_of(files: Record<string, string>): Promise<string | undefined> {
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files, base: BASE })

	return await run_review_pinned_tree.key()
}

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

// joshuafolkken/kit#5002: `review:record` wrote an observation line after the launch, and the ship's
// pre-detach read the tree as moved, waited the launch out and ran its own probe.
describe("run_review_pinned_tree.key with a run's own records", () => {
	it('keys a tree that only gained an observation line or a metrics approval as the same tree', async () => {
		const launched = await key_of(FILES)

		expect(await key_of(RECORDED)).toBe(launched)
		expect(await key_of({ ...RECORDED, ...APPROVAL })).toBe(launched)
	})

	it.each(['vitest.config.ts', 'a.test.ts', B_FILE])(
		'keys a tree whose %s changed beside a record as another tree',
		async (file) => {
			const launched = await key_of(RECORDED)

			expect(await key_of({ ...RECORDED, [file]: 'digest-moved' })).not.toBe(launched)
		},
	)

	it('keys a tree whose only change is a record, as its base with no change', async () => {
		const records_only = await key_of(OBSERVATION)

		expect(records_only).toBeDefined()
		expect(await key_of(APPROVAL)).toBe(records_only)
	})
})
