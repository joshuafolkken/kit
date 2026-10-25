import { randomUUID } from 'node:crypto'
import { core_budget } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { test_pinned_record } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_join } from './run-review-pinned-join'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_pinned_tree } from './run-review-pinned-tree'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4888: one `test:pinned` answer per tree, read by `--join` and the ship's pre-detach.

const ROOT = `/nonexistent/run-review-pinned-join-${randomUUID()}`
const BRIEFED_PID = 4878
const FIXED_PID = 4888
const BRIEFED_TREE = 'briefed-tree'
const FIXED_TREE = 'fixed-tree'
const REASON = 'only logs'
const ANSWER = { text: 'unpinned 0 · unchecked 0\n', unpinned: [] }
const GIT_FAILED = new Error('git failed')

function launched_token(): string {
	const [argv] = vi.mocked(run_review_steps.launch_josh).mock.lastCall ?? [[]]

	return String(argv.at(-1))
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

// joshuafolkken/kit#4878: a round-1 fix moved the tree, and `--join` waited out the grace on the
// pre-fix check before stopping it.
describe('run_review_pinned_join.wait_for_join on a tree a round-1 fix moved', () => {
	it("stops the pre-fix check and reads the fixed tree's answer without waiting out the grace", async () => {
		run_review_pinned_steps.launch(ROOT, REASON, BRIEFED_TREE)
		vi.mocked(run_review_steps.launch_josh).mockImplementation(() => {
			test_pinned_record.write(launched_token(), ANSWER, ROOT)

			return { kind: 'launched', pid: FIXED_PID }
		})
		const now = vi.fn(() => 0)

		const answer = await run_review_pinned_join.wait_for_join(ROOT, now)

		expect(process.kill).toHaveBeenCalledWith(-BRIEFED_PID, 'SIGTERM')
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
		expect(run_review_pinned_steps.launched_reason(ROOT)).toBe(REASON)
		expect(answer).toStrictEqual(ANSWER)
		expect(now).not.toHaveBeenCalled()
	})

	it('waits on the launch as it stands when git could not read the current tree', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		vi.mocked(run_review_pinned_tree.key).mockRejectedValue(GIT_FAILED)

		expect(await run_review_pinned_join.wait_for_join(ROOT)).toStrictEqual(ANSWER)
		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
	})

	it('starts nothing again on the tree the check was launched on', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.wait_for_join(ROOT)).toStrictEqual(ANSWER)
		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
	})
})

// joshuafolkken/kit#4895: the join waited out the grace on a tree round 1's fixes were about to move.
describe('run_review_pinned_join.wait_for_join with round-1 fixes to make', () => {
	it('waits no grace on a running check and leaves it running', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		const now = vi.fn(() => 0)

		const answer = await run_review_pinned_join.wait_for_join(ROOT, now, true)

		expect(now).not.toHaveBeenCalled()
		expect(process.kill).not.toHaveBeenCalled()
		expect(answer?.unpinned).toStrictEqual([])
		expect(answer?.text).toContain('round 1 has fixes to make')
	})

	it('reads the answer the check already left', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.wait_for_join(ROOT, undefined, true)).toStrictEqual(ANSWER)
	})

	it('answers none when no check was launched', async () => {
		expect(await run_review_pinned_join.wait_for_join(ROOT, undefined, true)).toBeUndefined()
	})
})

describe("run_review_pinned_join.wait_for_join under a ship's supervisor", () => {
	it('starts nothing again on a moved tree, where no --pinned read follows', async () => {
		vi.spyOn(run_ship_detach, 'is_supervised').mockReturnValue(true)
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.wait_for_join(ROOT)).toStrictEqual(ANSWER)
		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
	})
})

describe('run_review_pinned_join.answer_on_tree', () => {
	it("reads the background check's answer on the tree it was launched on", async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.answer_on_tree(ROOT)).toStrictEqual(ANSWER)
	})

	it.each([
		['another tree', BRIEFED_TREE],
		['no recorded tree', undefined],
	])('answers none for a check launched on %s', async (_label, tree) => {
		run_review_pinned_steps.launch(ROOT, undefined, tree)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.answer_on_tree(ROOT)).toBeUndefined()
	})

	it('answers none when git could not read the current tree', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		vi.mocked(run_review_pinned_tree.key).mockRejectedValue(GIT_FAILED)

		expect(await run_review_pinned_join.answer_on_tree(ROOT)).toBeUndefined()
	})

	it('answers none for a check that ended without an answer, so the caller runs its own', async () => {
		vi.mocked(process_identity.is_same_process).mockReturnValue(false)
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)

		expect(await run_review_pinned_join.answer_on_tree(ROOT)).toBeUndefined()
	})
})

// joshuafolkken/kit#4895: stopped mid-run, the check saved no verdicts, and the caller probed every hunk.
describe('run_review_pinned_join.answer_on_tree on another tree', () => {
	it('waits the check out before clearing it, so its verdicts reach the cache', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		vi.spyOn(run_review_pinned_steps, 'is_live').mockReturnValue(true)
		const waited = vi.spyOn(run_review_pinned_steps, 'wait_alone').mockResolvedValue(ANSWER)
		const cleared = vi.spyOn(run_review_pinned_steps, 'clear')

		await run_review_pinned_join.answer_on_tree(ROOT)

		expect(waited).toHaveBeenCalledWith(ROOT)
		expect(waited.mock.invocationCallOrder[0]).toBeLessThan(
			cleared.mock.invocationCallOrder[0] ?? 0,
		)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBeUndefined()
	})

	it('clears a stale stamp at once, waiting on and signalling no unproven pid', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		vi.spyOn(run_review_pinned_steps, 'is_live').mockReturnValue(false)
		const waited = vi.spyOn(run_review_pinned_steps, 'wait_alone')

		await run_review_pinned_join.answer_on_tree(ROOT)

		expect(waited).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBeUndefined()
	})
})
