import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewCheckout } from './review-checkout'

const read_mock = vi.hoisted(() => vi.fn())
const briefed_since_mock = vi.hoisted(() => vi.fn())
const attested_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())
const checkout_mock = vi.hoisted(() => vi.fn())

const marker = vi.hoisted(() => new Map<string, string>())

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: (path: string) => marker.get(path),
		remove_stamp: (path: string) => marker.delete(path),
		stamp_path: (prefix: string) => prefix,
		write_text_stamp: (path: string, text: string) => marker.set(path, text),
	},
}))
vi.mock('./review-stamps', () => ({
	review_stamps: { reviewed_stamp: { read: read_mock, remove: vi.fn(), write: write_mock } },
}))
vi.mock('./review-attest', () => ({
	review_attest: { is_attested_on: attested_mock, is_briefed_since: briefed_since_mock },
}))
vi.mock('./review-checkout', () => ({ review_checkout: { read_checkout: checkout_mock } }))

const { review_reviewed_tree } = await import('./review-reviewed-tree')

// joshuafolkken/kit#4620: the tree a recorded round stands for decides whether the ship reuses it, and
// where a resumed brief narrows from.

const BASE = 'base-sha'
const FILE = 'a.ts'
const STAMP: FileMapStamp = {
	taken_at: '2026-10-23T00:00:00.000Z',
	files: { [FILE]: 'x' },
	base: BASE,
}
const CHECKOUT: ReviewCheckout = { root: '/lanes/4620', branch: '4620-lane', head: 'head' }

describe('review_reviewed_tree.is_unmoved', () => {
	it('answers true for the same files on the same base', () => {
		expect(review_reviewed_tree.is_unmoved(STAMP, { files: { [FILE]: 'x' }, base: BASE })).toBe(
			true,
		)
	})

	it.each([
		['a changed file', { files: { [FILE]: 'y' }, base: BASE }],
		['another base', { files: { [FILE]: 'x' }, base: 'other' }],
		['an empty tree', { files: {}, base: BASE }],
	])('answers false on %s', (_case, tree) => {
		expect(review_reviewed_tree.is_unmoved(STAMP, tree)).toBe(false)
	})
})

describe('review_reviewed_tree.is_unmoved_here', () => {
	beforeEach(() => {
		read_mock.mockReset().mockReturnValue(STAMP)
		attested_mock.mockReset().mockReturnValue(true)
		checkout_mock.mockReset().mockResolvedValue(CHECKOUT)
		gate_tree_mock.mockReset().mockResolvedValue({ files: { [FILE]: 'x' }, base: BASE })
	})

	it('answers true for an attested review whose recorded tree held still', async () => {
		expect(await review_reviewed_tree.is_unmoved_here()).toBe(true)
		expect(attested_mock).toHaveBeenCalledWith(CHECKOUT, CHECKOUT.root)
	})

	it('answers false without a record', async () => {
		read_mock.mockReturnValue(undefined)

		expect(await review_reviewed_tree.is_unmoved_here()).toBe(false)
	})

	// The reuse skips the ship's own attest, so an unattested review is never reused.
	it('answers false on an unmoved tree whose review was not attested on this branch', async () => {
		attested_mock.mockReturnValue(false)

		expect(await review_reviewed_tree.is_unmoved_here()).toBe(false)
	})
})

describe('review_reviewed_tree.resume_point', () => {
	beforeEach(() => {
		read_mock.mockReset().mockReturnValue(STAMP)
		briefed_since_mock.mockReset().mockReturnValue(true)
		attested_mock.mockReset().mockReturnValue(true)
	})

	it('narrows from a record written since the brief whose review was attested', () => {
		expect(review_reviewed_tree.resume_point(CHECKOUT)).toBe(STAMP)
		expect(briefed_since_mock).toHaveBeenCalledWith(STAMP.taken_at, CHECKOUT.root)
	})

	it('answers nothing without a record', () => {
		read_mock.mockReturnValue(undefined)

		expect(review_reviewed_tree.resume_point(CHECKOUT)).toBeUndefined()
	})

	it('answers nothing for a record older than the brief', () => {
		briefed_since_mock.mockReturnValue(false)

		expect(review_reviewed_tree.resume_point(CHECKOUT)).toBeUndefined()
	})

	it('answers nothing when the brief was not attested on this branch', () => {
		attested_mock.mockReturnValue(false)

		expect(review_reviewed_tree.resume_point(CHECKOUT)).toBeUndefined()
	})
})

describe('review_reviewed_tree.record', () => {
	const other = 'b.ts'
	const tree = { files: { [FILE]: 'x', [other]: 'y' }, base: BASE }

	async function recorded(unsettled: ReadonlyArray<string>): Promise<FileMapStamp> {
		gate_tree_mock.mockResolvedValue(tree)
		write_mock.mockClear()
		await review_reviewed_tree.record(unsettled)
		const [files] = write_mock.mock.calls[0] as [Record<string, string>]

		return { taken_at: STAMP.taken_at, files, base: BASE }
	}

	it('records the tree as it stands when no finding is unsettled', async () => {
		expect(review_reviewed_tree.is_unmoved(await recorded([]), tree)).toBe(true)
	})

	// The second case is a reader outside the change, which a High cites at the reader's line.
	it.each([`${other}:12`, 'outside.ts:3'])(
		'records a tree that reads as moved while a High cites %s',
		async (unsettled) => {
			expect(review_reviewed_tree.is_unmoved(await recorded([unsettled]), tree)).toBe(false)
		},
	)
})
