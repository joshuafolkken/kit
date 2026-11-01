import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())
const git_read_mock = vi.hoisted(() => vi.fn())
const carried_delta_mock = vi.hoisted(() => vi.fn())
const capture_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: git_read_mock } }))
vi.mock('./review-stamps', () => ({
	review_stamps: {
		reviewed_stamp: { read: read_mock, write: write_mock },
		round_one_stamp: { read: vi.fn() },
	},
}))
vi.mock('./review-attest', () => ({ review_attest: { is_attested_on: () => true } }))
vi.mock('./review-checkout', () => ({
	review_checkout: { read_checkout: async () => ({ root: '/lanes/4984' }) },
}))
vi.mock('./review-round-one-blobs', () => ({
	review_round_one_blobs: { capture: capture_mock, carried_delta: carried_delta_mock },
}))

const { review_reviewed_tree } = await import('./review-reviewed-tree')

// joshuafolkken/kit#4984: the #4970 ship — main rewrote a generated usage heading the lane changed too,
// so the recorded round 1 stands where round 2 would not execute what main alone moved.

const FILE = 'a.ts'
const DOC = 'docs/josh-commands.md'
const BLOBS = { [FILE]: 'blob-a', [DOC]: 'blob-d' }
const STAMP: FileMapStamp = {
	taken_at: '2026-10-26T00:00:00.000Z',
	files: { [FILE]: 'x', [DOC]: 'd' },
	base: 'base-sha',
	blobs: BLOBS,
}
const SYNCED_CAUSE = 'the default branch changed a file the round covers'
const UNEXECUTED_NOTE = 'passed over documentation, a prompt or an inert path no round executes'

const { HELD, UNSETTLED } = review_reviewed_tree.MOVEMENT

function arrange_synced_document(): void {
	read_mock.mockReset().mockReturnValue(STAMP)
	gate_tree_mock.mockReset().mockResolvedValue({ files: { [FILE]: 'x', [DOC]: 'e' }, base: 'new' })
	git_read_mock.mockReset().mockResolvedValue(`${DOC}\0main.ts\0`)
	carried_delta_mock.mockReset().mockReturnValue([])
}

describe('review_reviewed_tree.standing_here on a base the sync moved under a covered document', () => {
	beforeEach(arrange_synced_document)

	it('answers held when the default branch alone moved the covered document', async () => {
		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: HELD })
		expect(carried_delta_mock).toHaveBeenCalledWith({
			blobs: BLOBS,
			from: STAMP.base,
			to: 'new',
			paths: [DOC],
		})
	})

	it('answers synced on the covered document when the lane edited it since the record', async () => {
		carried_delta_mock.mockReturnValue([DOC])

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: UNSETTLED,
			cause: `${SYNCED_CAUSE}: ${DOC}`,
		})
	})
})

// joshuafolkken/kit#5791: the #5757 ship — a document the branch added has no blob on one side, so git
// cannot carry it, yet round 2 would not execute it either; round 1 stands, its note naming the path.
describe('review_reviewed_tree.standing_here on a covered document git could not carry', () => {
	beforeEach(arrange_synced_document)

	it('answers held with the document passed over in the note', async () => {
		carried_delta_mock.mockReturnValue(undefined)

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: HELD,
			note: `${UNEXECUTED_NOTE}: ${DOC}`,
		})
	})

	it('answers synced on a covered runtime file beside it', async () => {
		carried_delta_mock.mockReturnValue(undefined)
		git_read_mock.mockResolvedValue(`${DOC}\0${FILE}\0`)

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: UNSETTLED,
			cause: `${SYNCED_CAUSE}: ${FILE}`,
		})
	})
})

describe('review_reviewed_tree.standing_here on a base the sync moved under a file round 2 executes', () => {
	beforeEach(arrange_synced_document)

	it('answers synced when the default branch changed a covered runtime file too', async () => {
		git_read_mock.mockResolvedValue(`${DOC}\0${FILE}\0`)

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: UNSETTLED,
			cause: `${SYNCED_CAUSE}: ${FILE}`,
		})
	})

	it('answers unsettled when the covered document is one a recorded High cites', async () => {
		read_mock.mockReturnValue({ ...STAMP, files: { [FILE]: 'x', [DOC]: 'unsettled' } })

		const standing = await review_reviewed_tree.standing_here()

		expect(standing.movement).toBe(UNSETTLED)
		expect(carried_delta_mock).not.toHaveBeenCalled()
	})

	// Round 2's carried delta leaves out what the default branch changed, so round 1 reads it again.
	it('answers unsettled when the default branch changed a recorded runtime file', async () => {
		git_read_mock.mockResolvedValue(`${FILE}\0`)

		expect(
			await review_reviewed_tree.movement(STAMP, { files: { [FILE]: 'x' }, base: 'new' }),
		).toBe(UNSETTLED)
	})
})

describe('review_reviewed_tree.record of the blobs a sync carries', () => {
	it('records the blobs of the tree it stamps', async () => {
		gate_tree_mock.mockResolvedValue({ files: STAMP.files, base: STAMP.base })
		capture_mock.mockReturnValue(BLOBS)

		await review_reviewed_tree.record()

		expect(capture_mock).toHaveBeenCalledWith([FILE, DOC])
		expect(write_mock).toHaveBeenCalledWith(STAMP.files, undefined, STAMP.base, BLOBS)
	})
})
