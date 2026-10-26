import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())
const git_read_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: git_read_mock } }))
vi.mock('./review-stamps', () => ({
	review_stamps: { reviewed_stamp: { read: read_mock }, round_one_stamp: { read: vi.fn() } },
}))
vi.mock('./review-attest', () => ({ review_attest: { is_attested_on: () => true } }))
vi.mock('./review-checkout', () => ({
	review_checkout: { read_checkout: async () => ({ root: '/lanes/4984' }) },
}))

const { review_reviewed_tree } = await import('./review-reviewed-tree')

// joshuafolkken/kit#4984: the #4970 ship — main rewrote a generated usage heading the lane changed too,
// so the recorded round 1 stands where round 2 would not execute what main changed.

const FILE = 'a.ts'
const DOC = 'docs/josh-commands.md'
const STAMP: FileMapStamp = {
	taken_at: '2026-10-26T00:00:00.000Z',
	files: { [FILE]: 'x', [DOC]: 'd' },
	base: 'base-sha',
}

describe('review_reviewed_tree.standing_here on a base the sync moved under a covered document', () => {
	const { HELD, UNSETTLED } = review_reviewed_tree.MOVEMENT

	beforeEach(() => {
		read_mock.mockReset().mockReturnValue(STAMP)
		gate_tree_mock
			.mockReset()
			.mockResolvedValue({ files: { [FILE]: 'x', [DOC]: 'e' }, base: 'new' })
		git_read_mock.mockReset()
	})

	it('answers held when the default branch changed only the covered document', async () => {
		git_read_mock.mockResolvedValue(`${DOC}\0main.ts\0`)

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: HELD })
	})

	it('answers synced when the default branch changed a covered runtime file too', async () => {
		git_read_mock.mockResolvedValue(`${DOC}\0${FILE}\0`)

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: UNSETTLED,
			cause: `the default branch changed a file the round covers: ${FILE}`,
		})
	})

	it('answers unsettled when the covered document is one a recorded High cites', async () => {
		read_mock.mockReturnValue({ ...STAMP, files: { [FILE]: 'x', [DOC]: 'unsettled' } })
		git_read_mock.mockResolvedValue(`${DOC}\0`)

		const standing = await review_reviewed_tree.standing_here()

		expect(standing.movement).toBe(UNSETTLED)
	})
})
