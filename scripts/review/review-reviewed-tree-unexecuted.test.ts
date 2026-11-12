import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const read_mock = vi.hoisted(() => vi.fn())
const briefed_mock = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('./review-stamps', () => ({
	review_stamps: { reviewed_stamp: { read: read_mock }, round_one_stamp: { read: briefed_mock } },
}))
vi.mock('./review-attest', () => ({ review_attest: { is_attested_on: () => true } }))
vi.mock('./review-checkout', () => ({
	review_checkout: { read_checkout: async () => ({ root: '/lanes/5662' }) },
}))

const { review_reviewed_tree } = await import('./review-reviewed-tree')

// joshuafolkken/kit#5662: the #5352 ship re-ran `--review` after round 1 because only
// `docs/josh-commands-run.md` moved — a path round 2 does not execute either.

const BASE = 'base-sha'
const CODE = 'a.ts'
const DOC = 'docs/josh-commands-run.md'
const STAMP: FileMapStamp = {
	taken_at: '2026-11-01T00:00:00.000Z',
	files: { [CODE]: 'x', [DOC]: 'd' },
	base: BASE,
}
const NOTE = `passed over documentation, a prompt or an inert path no round executes: ${DOC}`
const { DELTA, HELD, UNSETTLED } = review_reviewed_tree.MOVEMENT

function arrange_recorded(): void {
	read_mock.mockReset().mockReturnValue(STAMP)
	briefed_mock.mockReset().mockReturnValue(undefined)
}

describe('review_reviewed_tree.standing_here after a move round 2 does not execute', () => {
	beforeEach(arrange_recorded)

	it('holds the round when only documentation moved since the record, naming it', async () => {
		gate_tree_mock.mockResolvedValue({ files: { [CODE]: 'x', [DOC]: 'e' }, base: BASE })

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: HELD, note: NOTE })
	})

	it('leaves the code beside the documentation to round 2', async () => {
		gate_tree_mock.mockResolvedValue({ files: { [CODE]: 'y', [DOC]: 'e' }, base: BASE })

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({
			movement: DELTA,
			note: NOTE,
		})
	})
})

describe('review_reviewed_tree.standing_here when round 1 is reviewed again past a doc move', () => {
	beforeEach(arrange_recorded)

	// The documentation passed over beside it is no reuse, so the answer carries no note.
	it.each([
		['unmoved', 'd'],
		['moved', 'e'],
	])(
		'reviews round 1 again when the code is back at its briefed bytes, the doc %s',
		async (_case, document_) => {
			briefed_mock.mockReturnValue({ ...STAMP, files: { [CODE]: 'y' } })
			gate_tree_mock.mockResolvedValue({ files: { [CODE]: 'y', [DOC]: document_ }, base: BASE })

			const standing = await review_reviewed_tree.standing_here()

			expect(standing.movement).toBe(UNSETTLED)
			expect(standing.cause).toMatch(new RegExp(`: ${CODE}$`, 'u'))
			expect(standing.note).toBeUndefined()
		},
	)

	it('reviews round 1 again when the documentation is one a recorded High cites', async () => {
		read_mock.mockReturnValue({ ...STAMP, files: { [CODE]: 'x', [DOC]: 'unsettled' } })
		gate_tree_mock.mockResolvedValue({ files: { [CODE]: 'x', [DOC]: 'e' }, base: BASE })

		const standing = await review_reviewed_tree.standing_here()

		expect(standing.movement).toBe(UNSETTLED)
		expect(standing.cause).toMatch(
			new RegExp(`would not read.*an inert path a recorded High cites: ${DOC}$`, 'u'),
		)
	})
})
