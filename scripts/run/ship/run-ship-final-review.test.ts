import { randomUUID } from 'node:crypto'
import { gate_tree, type GateTree } from '#scripts/gate/gate-tree'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { file_map_stamp } from '#scripts/josh/file-map-stamp'
import { review_round_reuse } from '#scripts/review/review-round-reuse'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { run_ship_final_review } from './run-ship-final-review'

vi.mock('#scripts/gate/gate-tree', () => ({ gate_tree: { read_gate_tree: vi.fn() } }))
vi.mock('#scripts/review/review-round-reuse', () => ({
	review_round_reuse: { is_stale_here: vi.fn() },
}))

const ISSUE = randomUUID()
const SOURCE = 'source.ts'
const TEST = 'source.test.ts'
const TREE: GateTree = { base: 'base', files: { [SOURCE]: 'digest' } }
const PASS = { code: 0, out: 'review passed' }
const review = vi.fn(async () => PASS)
const stamp = file_map_stamp.create(`josh-ship-final-review-${ISSUE}-`, PROJECT_ROOT)

beforeEach(() => {
	vi.clearAllMocks()
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(TREE)
	vi.mocked(review_round_reuse.is_stale_here).mockResolvedValue(false)
	review.mockResolvedValue(PASS)
})

afterEach(() => {
	stamp.remove()
})

it.each(['gate', 'commit'])(
	'reuses the final review after a %s stop on the same tree',
	async () => {
		expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
		expect(await run_ship_final_review.run(ISSUE, review)).toMatchObject({ is_skipped: true })
		expect(review).toHaveBeenCalledOnce()
	},
)

it.each<GateTree>([
	{ ...TREE, base: 'new base' },
	{ ...TREE, base: undefined },
	{ ...TREE, files: {} },
	{ ...TREE, files: { [SOURCE]: 'changed' } },
	{ ...TREE, files: { ...TREE.files, [TEST]: 'new test' } },
])('reviews again when the reviewed tree changes: %j', async (tree) => {
	await run_ship_final_review.run(ISSUE, review)
	vi.mocked(gate_tree.read_gate_tree).mockResolvedValue(tree)

	expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
	expect(review).toHaveBeenCalledTimes(2)
})

it('does not reuse an unsuccessful or interrupted review', async () => {
	review.mockResolvedValueOnce({ code: 1, out: 'finding' })
	await run_ship_final_review.run(ISSUE, review)
	expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
	stamp.write(TREE.files, undefined, TREE.base)
	expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
	expect(review).toHaveBeenCalledTimes(3)
})

it('does not reuse a review after the issue changes', async () => {
	await run_ship_final_review.run(ISSUE, review)
	vi.mocked(review_round_reuse.is_stale_here).mockResolvedValue(true)

	expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
	expect(review).toHaveBeenCalledTimes(2)
})

it('keeps the tree read before the review rather than blessing edits made during it', async () => {
	review.mockImplementationOnce(async () => {
		vi.mocked(gate_tree.read_gate_tree).mockResolvedValue({ ...TREE, files: { added: 'edit' } })

		return PASS
	})
	await run_ship_final_review.run(ISSUE, review)

	expect(await run_ship_final_review.run(ISSUE, review)).toStrictEqual(PASS)
	expect(review).toHaveBeenCalledTimes(2)
})
