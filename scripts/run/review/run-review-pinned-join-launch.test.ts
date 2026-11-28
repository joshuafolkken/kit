import { randomUUID } from 'node:crypto'
import { core_budget } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { test_pinned_record, type PinnedSummary } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#8271: the fixed tree's `test:pinned` runs once — the recheck before the ship launches
// it, and the ship's pre-detach reads that same answer.

const ROOT = `/nonexistent/run-review-pinned-join-launch-${randomUUID()}`
const BRIEFED_PID = 4878
const FIXED_PID = 8271
const BRIEFED_TREE = 'briefed-tree'
const FIXED_TREE = 'fixed-tree'
const REASON = 'only logs'
const ANSWER: PinnedSummary = { text: 'unpinned 0 · unchecked 0\n', unpinned: [] }
const UNPINNED: PinnedSummary = { text: 'unpinned 1 · unchecked 0\n', unpinned: ['scripts/a.ts:1'] }

function launched_token(): string {
	const [argv] = vi.mocked(run_review_steps.launch_josh).mock.lastCall ?? [[]]

	return String(argv.at(-1))
}

// Each launch answers at once, as a finished background check would.
function answer_each_launch(answer: PinnedSummary): void {
	vi.mocked(run_review_steps.launch_josh)
		.mockReset()
		.mockImplementation(() => {
			test_pinned_record.write(launched_token(), answer, ROOT)

			return { kind: 'launched', pid: FIXED_PID }
		})
}

beforeEach(() => {
	vi.spyOn(core_budget, 'live_reservations').mockReturnValue([])
	vi.spyOn(run_review_steps, 'launch_josh')
		.mockReturnValueOnce({ kind: 'launched', pid: BRIEFED_PID })
		.mockReturnValue({ kind: 'launched', pid: FIXED_PID })
	vi.spyOn(process_identity, 'read_start').mockReturnValue('start')
	vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
	vi.spyOn(process, 'kill').mockReturnValue(true)
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(FIXED_TREE)
})

afterEach(() => {
	run_review_pinned_steps.clear(ROOT)
	vi.restoreAllMocks()
})

describe('run_review_pinned_join.launch_on_tree', () => {
	it('launches the check on the current tree with the reason when none was launched', async () => {
		await run_review_pinned_join.launch_on_tree(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
		expect(run_review_pinned_steps.launched_reason(ROOT)).toBe(REASON)
	})

	it('starts nothing again on the tree a check was launched on', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)

		await run_review_pinned_join.launch_on_tree(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
	})

	it("settles the briefed tree's check, then launches on the fixed tree", async () => {
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		await run_review_pinned_join.launch_on_tree(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledTimes(2)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
	})

	it('starts nothing on a tree git could not read', async () => {
		vi.mocked(run_review_pinned_tree.key).mockRejectedValue(new Error('git failed'))

		await run_review_pinned_join.launch_on_tree(ROOT, REASON)

		expect(run_review_steps.launch_josh).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#9165: the check `josh run:cut` started on the settled tree is kept by round 1.
describe('run_review_pinned_join.launch_kept', () => {
	it('keeps a check standing on the same tree under the same reason', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)

		await expect(run_review_pinned_join.launch_kept(ROOT, REASON)).resolves.toBeUndefined()

		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
		expect(process.kill).not.toHaveBeenCalled()
	})

	it("stops another tree's check and launches on the current tree, never reading the old answer", async () => {
		run_review_pinned_steps.launch(ROOT, REASON, BRIEFED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		await run_review_pinned_join.launch_kept(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledTimes(2)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
		await expect(run_review_pinned_join.finished_on_tree(ROOT)).resolves.toBeUndefined()
	})

	it('launches again under a different reason', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)

		await run_review_pinned_join.launch_kept(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledTimes(2)
		expect(run_review_pinned_steps.launched_reason(ROOT)).toBe(REASON)
	})

	it('launches again over a stale stamp whose process died with no answer', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		vi.mocked(process_identity.is_same_process).mockReturnValue(false)

		await run_review_pinned_join.launch_kept(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledTimes(2)
	})
})

describe('run_review_pinned_join.launch_kept on an ended stamp', () => {
	it('keeps a check that ended with its answer written', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		vi.mocked(process_identity.is_same_process).mockReturnValue(false)

		await run_review_pinned_join.launch_kept(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
	})

	it("launches the full check over a pre-detach's rest-of-range stamp on the same tree", async () => {
		run_review_pinned_steps.launch_remaining(ROOT, FIXED_TREE, REASON)

		await run_review_pinned_join.launch_kept(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledTimes(2)
		expect(run_review_pinned_steps.is_remaining(ROOT)).toBe(false)
	})
})

// ac-0b9841e2 / ac-d3e42cae: the recheck and the ship's pre-detach each read the fixed tree's answer.
describe('run_review_pinned_join — the recheck, then the ship, on one fixed tree', () => {
	it.each([
		['a pinned tree', ANSWER],
		['an unpinned place, which both still stop on', UNPINNED],
	])('runs test:pinned once and answers both reads on %s', async (_label, answer) => {
		answer_each_launch(answer)

		await run_review_pinned_join.launch_on_tree(ROOT, REASON)
		const recheck = await run_review_pinned_join.answer_on_tree(ROOT)

		await run_review_pinned_join.launch_on_tree(ROOT, REASON)
		const ship = await run_review_pinned_join.answer_on_tree(ROOT)

		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
		expect(recheck).toStrictEqual(answer)
		expect(ship).toStrictEqual(answer)
	})
})
