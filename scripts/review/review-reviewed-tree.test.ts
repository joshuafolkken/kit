import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewCheckout } from './review-checkout'

const read_mock = vi.hoisted(() => vi.fn())
const briefed_mock = vi.hoisted(() => vi.fn())
const briefed_since_mock = vi.hoisted(() => vi.fn())
const attested_mock = vi.hoisted(() => vi.fn())
const write_mock = vi.hoisted(() => vi.fn())
const remove_mock = vi.hoisted(() => vi.fn())
const gate_tree_mock = vi.hoisted(() => vi.fn())
const checkout_mock = vi.hoisted(() => vi.fn())
const git_read_mock = vi.hoisted(() => vi.fn())

const marker = vi.hoisted(() => new Map<string, string>())

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: gate_tree_mock } }))
vi.mock('#scripts/git/git-spawn', () => ({ git_spawn: { read: git_read_mock } }))
vi.mock('#scripts/josh/stamp-file', () => ({
	stamp_file: {
		read_stamp_text: (path: string) => marker.get(path),
		remove_stamp: (path: string) => marker.delete(path),
		stamp_path: (prefix: string) => prefix,
		write_text_stamp: (path: string, text: string) => marker.set(path, text),
	},
}))
vi.mock('./review-stamps', () => ({
	review_stamps: {
		reviewed_stamp: { read: read_mock, remove: remove_mock, write: write_mock },
		round_one_stamp: { read: briefed_mock },
	},
}))
vi.mock('./review-attest', () => ({
	review_attest: { is_attested_on: attested_mock, is_briefed_since: briefed_since_mock },
}))
vi.mock('./review-checkout', () => ({ review_checkout: { read_checkout: checkout_mock } }))
vi.mock('./review-round-one-blobs', () => ({
	review_round_one_blobs: { capture: () => undefined, carried_delta: () => undefined },
}))

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
const PROMPT = 'prompts/new.md'
const CHECKOUT: ReviewCheckout = { root: '/lanes/4620', branch: '4620-lane', head: 'head' }

describe('review_reviewed_tree.is_unmoved', () => {
	beforeEach(() => {
		git_read_mock.mockReset()
	})

	it('answers true for the same files on the same base', async () => {
		expect(
			await review_reviewed_tree.is_unmoved(STAMP, { files: { [FILE]: 'x' }, base: BASE }),
		).toBe(true)
	})

	it.each([
		['a changed file', { files: { [FILE]: 'y' }, base: BASE }],
		['an unresolved base', { files: { [FILE]: 'x' }, base: undefined }],
		['an empty tree', { files: {}, base: BASE }],
	])('answers false on %s', async (_case, tree) => {
		expect(await review_reviewed_tree.is_unmoved(STAMP, tree)).toBe(false)
	})
})

// joshuafolkken/kit#4788: the ship's pre-detach `josh metrics --rerecord` rewrites the branch's
// approval after `review:record`.
describe('review_reviewed_tree.is_unmoved after the approval was re-recorded', () => {
	const APPROVAL = '.josh/metrics-accepted/4788.json'
	const recorded: FileMapStamp = { ...STAMP, files: { [FILE]: 'x', [APPROVAL]: 'old' } }

	it('answers true when only the approval changed', async () => {
		const tree = { files: { [FILE]: 'x', [APPROVAL]: 'new' }, base: BASE }

		expect(await review_reviewed_tree.is_unmoved(recorded, tree)).toBe(true)
	})

	it('answers false when the approval is one a recorded High cites', async () => {
		const unsettled: FileMapStamp = { ...STAMP, files: { [FILE]: 'x', [APPROVAL]: 'unsettled' } }
		const tree = { files: { [FILE]: 'x', [APPROVAL]: 'new' }, base: BASE }

		expect(await review_reviewed_tree.is_unmoved(unsettled, tree)).toBe(false)
	})

	it('answers false when a file besides the approval changed too', async () => {
		const tree = { files: { [FILE]: 'y', [APPROVAL]: 'new' }, base: BASE }

		expect(await review_reviewed_tree.is_unmoved(recorded, tree)).toBe(false)
	})
})

// joshuafolkken/kit#4874: `chain-rule.md` step 0 pins each unpinned place after `review:record`.
describe('review_reviewed_tree.is_unmoved after pinning tests were added', () => {
	const PINNED = 'a.test.ts'
	const recorded: FileMapStamp = { ...STAMP, files: { [FILE]: 'x', [PINNED]: 'old' } }

	it.each([
		['a test was added', STAMP, { [FILE]: 'x', [PINNED]: 'new' }],
		['a test was edited', recorded, { [FILE]: 'x', [PINNED]: 'new' }],
	])('answers true when %s', async (_case, stamp, files) => {
		expect(await review_reviewed_tree.is_unmoved(stamp, { files, base: BASE })).toBe(true)
	})

	it.each([
		['a runtime file changed beside the test', recorded, { [FILE]: 'y', [PINNED]: 'new' }],
		['a test was removed', recorded, { [FILE]: 'x' }],
		[
			'the test is one a recorded High cites',
			{ ...STAMP, files: { [FILE]: 'x', [PINNED]: 'unsettled' } },
			{ [FILE]: 'x', [PINNED]: 'new' },
		],
	])('answers false when %s', async (_case, stamp, files) => {
		expect(await review_reviewed_tree.is_unmoved(stamp, { files, base: BASE })).toBe(false)
	})
})

// joshuafolkken/kit#4829: the ship's sync moves the base under a recorded round.
describe('review_reviewed_tree.is_unmoved on a base the sync moved', () => {
	const moved = { files: { [FILE]: 'x' }, base: 'new-base' }

	beforeEach(() => {
		git_read_mock.mockReset()
	})

	it('answers true when the default branch changed no recorded file', async () => {
		git_read_mock.mockResolvedValue('main.ts\0docs/main.md\0')

		expect(await review_reviewed_tree.is_unmoved(STAMP, moved)).toBe(true)
		expect(git_read_mock).toHaveBeenCalledWith(expect.arrayContaining([BASE, moved.base]))
	})

	it('answers false when the default branch changed a recorded file', async () => {
		git_read_mock.mockResolvedValue(`main.ts\0${FILE}\0`)

		expect(await review_reviewed_tree.is_unmoved(STAMP, moved)).toBe(false)
	})

	it('answers false when the recorded base is not in the history', async () => {
		git_read_mock.mockRejectedValue(new Error('fatal: bad revision'))

		expect(await review_reviewed_tree.is_unmoved(STAMP, moved)).toBe(false)
	})
})

// joshuafolkken/kit#4878: a tree moved only where round 2 reads leaves the delta to round 2.
describe('review_reviewed_tree.movement', () => {
	const { DELTA, HELD, UNSETTLED } = review_reviewed_tree.MOVEMENT
	const ADDED = 'c.ts'

	it.each([
		['the tree held still', STAMP, { [FILE]: 'x' }, HELD],
		['a runtime file changed', STAMP, { [FILE]: 'y' }, DELTA],
		['a runtime file was added', STAMP, { [FILE]: 'x', [ADDED]: 'z' }, DELTA],
		['git answered nothing', STAMP, {}, UNSETTLED],
		['a prompt round 2 passes over was added', STAMP, { [FILE]: 'x', [PROMPT]: 'p' }, UNSETTLED],
	])('answers the movement when %s', async (_case, stamp, files, expected) => {
		expect(await review_reviewed_tree.movement(stamp, { files, base: BASE })).toBe(expected)
	})

	// Round 2 diffs from the round-1 brief's stamp, so a file back at its briefed bytes drops out of it.
	it.each([
		['moved past its briefed bytes', 'b', DELTA],
		['reverted to its briefed bytes', 'y', UNSETTLED],
	])('answers the movement for a file %s', async (_case, briefed_digest, expected) => {
		const briefed: FileMapStamp = { ...STAMP, files: { [FILE]: briefed_digest } }
		const tree = { files: { [FILE]: 'y' }, base: BASE }

		expect(await review_reviewed_tree.movement(STAMP, tree, briefed)).toBe(expected)
	})
})

// joshuafolkken/kit#4941: round 2 reads a High's fix where its delta holds it, so the ship reuses round 1.
describe('review_reviewed_tree.movement of a file a recorded High cites', () => {
	const { DELTA, UNSETTLED } = review_reviewed_tree.MOVEMENT
	const CITED = 'b.ts'

	function cited(path: string): FileMapStamp {
		return { ...STAMP, files: { [FILE]: 'x', [path]: UNSETTLED } }
	}

	it.each([
		['fixed in the change', CITED, { [FILE]: 'x', [CITED]: 'w' }, DELTA],
		['outside the change', CITED, { [FILE]: 'x' }, UNSETTLED],
		['a prompt, fixed', PROMPT, { [FILE]: 'x', [PROMPT]: 'p' }, UNSETTLED],
	])('answers the movement for one %s', async (_case, path, files, expected) => {
		expect(await review_reviewed_tree.movement(cited(path), { files, base: BASE })).toBe(expected)
	})
})

function arrange_attested_held(): void {
	read_mock.mockReset().mockReturnValue(STAMP)
	attested_mock.mockReset().mockReturnValue(true)
	checkout_mock.mockReset().mockResolvedValue(CHECKOUT)
	gate_tree_mock.mockReset().mockResolvedValue({ files: { [FILE]: 'x' }, base: BASE })
	briefed_mock.mockReset().mockReturnValue(undefined)
	git_read_mock.mockReset()
}

describe('review_reviewed_tree.standing_here', () => {
	const { DELTA, HELD } = review_reviewed_tree.MOVEMENT

	beforeEach(arrange_attested_held)

	it('answers held for an attested review whose recorded tree held still', async () => {
		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: HELD })
		expect(attested_mock).toHaveBeenCalledWith(CHECKOUT, CHECKOUT.root)
	})

	it('answers delta for an attested review on a tree a settled file moved', async () => {
		gate_tree_mock.mockResolvedValue({ files: { [FILE]: 'y' }, base: BASE })

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: DELTA })
	})

	// joshuafolkken/kit#4941: the lane's #4926 record — a High's fix, then a test pinned after it.
	it('answers delta when only a High-cited fix and a pinning test moved since the record', async () => {
		const test_file = 'a.test.ts'

		read_mock.mockReturnValue({ ...STAMP, files: { [FILE]: 'unsettled', [test_file]: 't' } })
		briefed_mock.mockReturnValue({ ...STAMP, files: { [FILE]: 'x' } })
		gate_tree_mock.mockResolvedValue({ files: { [FILE]: 'y', [test_file]: 'u' }, base: BASE })

		expect(await review_reviewed_tree.standing_here()).toStrictEqual({ movement: DELTA })
	})
})

// joshuafolkken/kit#4941: `review:record --check` prints the condition that hit and its path.
describe('review_reviewed_tree.standing_here when unsettled', () => {
	const { UNSETTLED } = review_reviewed_tree.MOVEMENT

	beforeEach(arrange_attested_held)

	async function expect_unsettled(cause: string | RegExp): Promise<void> {
		const standing = await review_reviewed_tree.standing_here()

		expect(standing.movement).toBe(UNSETTLED)
		expect(standing.cause).toMatch(cause)
	}

	// The tree stands at the round-1 brief bytes in both: a revert, or a High's fix that never landed.
	it.each([
		['back at the round-1 brief bytes', 'x', 'y', 'revert to the briefed bytes'],
		['a recorded High cites, still unfixed', 'unsettled', 'x', 'a recorded High cites still holds'],
	])('names the condition and path of a file %s', async (_case, recorded, briefed, condition) => {
		read_mock.mockReturnValue({ ...STAMP, files: { [FILE]: recorded } })
		briefed_mock.mockReturnValue({ ...STAMP, files: { [FILE]: briefed } })
		gate_tree_mock.mockResolvedValue({ files: { [FILE]: briefed }, base: BASE })

		await expect_unsettled(new RegExp(`${condition}.*: ${FILE}$`, 'u'))
	})

	it('names the covered file the default branch changed', async () => {
		git_read_mock.mockResolvedValue(`${FILE}\0`)
		gate_tree_mock.mockResolvedValue({ files: { [FILE]: 'x' }, base: 'new' })

		await expect_unsettled(`the default branch changed a file the round covers: ${FILE}`)
	})

	it('answers unsettled without a record', async () => {
		read_mock.mockReturnValue(undefined)

		await expect_unsettled('no reviewed tree')
	})

	// The reuse skips the ship's own attest, so an unattested review is never reused.
	it('answers unsettled on an unmoved tree whose review was not attested on this branch', async () => {
		attested_mock.mockReturnValue(false)

		await expect_unsettled('not attested on this branch')
	})

	it('answers unsettled when git answered nothing', async () => {
		gate_tree_mock.mockResolvedValue({ files: {}, base: BASE })

		await expect_unsettled('git did not answer')
	})
})

describe('review_reviewed_tree.high_cited', () => {
	const cited = 'b.ts'

	it('answers the files a recorded High cites', () => {
		read_mock.mockReturnValue({ ...STAMP, files: { [FILE]: 'x', [cited]: 'unsettled' } })

		expect(review_reviewed_tree.high_cited()).toStrictEqual([cited])
	})

	it('answers none without a record', () => {
		read_mock.mockReturnValue(undefined)

		expect(review_reviewed_tree.high_cited()).toStrictEqual([])
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
		expect(await review_reviewed_tree.is_unmoved(await recorded([]), tree)).toBe(true)
	})

	// The second case is a reader outside the change, which a High cites at the reader's line.
	it.each([`${other}:12`, 'outside.ts:3'])(
		'records a tree that reads as moved while a High cites %s',
		async (unsettled) => {
			expect(await review_reviewed_tree.is_unmoved(await recorded([unsettled]), tree)).toBe(false)
		},
	)
})

// joshuafolkken/kit#2964: a round 1 that stopped on a finding is reused for its own issue alone.
describe('review_reviewed_tree stop marker', () => {
	const issue = 4620

	beforeEach(() => {
		marker.clear()
		remove_mock.mockReset()
	})

	it('answers stopped for the issue it marked, and for no other', () => {
		review_reviewed_tree.mark_stopped(issue, true)

		expect(review_reviewed_tree.is_stopped_on(issue)).toBe(true)
		expect(review_reviewed_tree.is_stopped_on(issue + 1)).toBe(false)
	})

	it('clears the marker when the round ends any other way', () => {
		review_reviewed_tree.mark_stopped(issue, true)
		review_reviewed_tree.mark_stopped(issue, false)

		expect(review_reviewed_tree.is_stopped_on(issue)).toBe(false)
	})

	it('drops both the marker and the recorded tree on discard', () => {
		review_reviewed_tree.mark_stopped(issue, true)
		review_reviewed_tree.discard()

		expect(review_reviewed_tree.is_stopped_on(issue)).toBe(false)
		expect(remove_mock).toHaveBeenCalledOnce()
	})
})
