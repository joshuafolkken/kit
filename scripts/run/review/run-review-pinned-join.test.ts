import { randomUUID } from 'node:crypto'
import { core_budget } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { test_pinned } from '#scripts/test/test-pinned'
import { test_pinned_logic, type PinnedReport } from '#scripts/test/test-pinned-logic'
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
const FIXING_TEXT = 'round 1 has fixes to make'
const EMPTY_REPORT: PinnedReport = {
	unpinned: [],
	stopped: [],
	unchecked: [],
	unparsed: [],
	max_hunks: test_pinned_logic.DEFAULT_MAX_HUNKS,
	has_runner: true,
}
const UNPINNED = {
	file: 'driver.js',
	new_start: 6,
	new_count: 1,
	old_lines: ['old'],
	is_green: true,
}

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
	vi.spyOn(test_pinned, 'cached').mockResolvedValue(EMPTY_REPORT)
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

// joshuafolkken/kit#5002: `--join` without `--fixing` started the check again on the moved tree, then
// waited the grace on a probe that never ends within it.
describe('run_review_pinned_join.wait_for_join on a moved tree with no fixes to make', () => {
	it('waits no grace on the check it started again and leaves it running', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, BRIEFED_TREE)
		const now = vi.fn(() => 0)

		const answer = await run_review_pinned_join.wait_for_join(ROOT, now)

		expect(now).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
		expect(process.kill).not.toHaveBeenCalledWith(-FIXED_PID, 'SIGTERM')
		expect(answer?.unpinned).toStrictEqual([])
		expect(answer?.text).toContain('started again on the moved tree')
		expect(answer?.text).not.toContain(FIXING_TEXT)
	})

	it('still waits the grace for the answer on an unmoved tree', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		const waited = vi.spyOn(run_review_pinned_steps, 'wait_for_answer').mockResolvedValue(ANSWER)

		expect(await run_review_pinned_join.wait_for_join(ROOT)).toStrictEqual(ANSWER)
		expect(waited).toHaveBeenCalledWith(ROOT, undefined)
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
		expect(answer?.text).toContain(FIXING_TEXT)
		// joshuafolkken/kit#4983: a lane child runs no `check:related` after round 1's fixes, so the note
		// names the `review:record` that restarts it.
		expect(answer?.text).toContain("the round's `josh review:record` starts it again")
		expect(answer?.text).not.toContain('`josh check:related`')
	})

	it('reads the answer the check already left', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.wait_for_join(ROOT, undefined, true)).toStrictEqual(ANSWER)
		expect(test_pinned.cached).not.toHaveBeenCalled()
	})

	it('answers none when no check was launched', async () => {
		expect(await run_review_pinned_join.wait_for_join(ROOT, undefined, true)).toBeUndefined()
	})
})

// joshuafolkken/kit#4936: the verdicts a running check already reached answer for the unmoved hunks.
describe('run_review_pinned_join.wait_for_join with round-1 fixes to make and a check still running', () => {
	it('shows unchecked-only cached places in the first fixing answer without another probe', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		vi.mocked(test_pinned.cached).mockResolvedValue({ ...EMPTY_REPORT, unchecked: [UNPINNED] })

		const answer = await run_review_pinned_join.wait_for_join(ROOT, undefined, true)

		expect(answer).toMatchObject({ is_partial: true, is_unchecked: true, unpinned: [] })
		expect(answer?.text).toContain('unchecked driver.js:6')
		expect(answer?.text).toContain('related regression test before ship')
		expect(test_pinned.cached).toHaveBeenCalledOnce()
		expect(run_review_steps.launch_josh).toHaveBeenCalledOnce()
		expect(process.kill).not.toHaveBeenCalled()
	})

	it('shows the unpinned hunks the cache already holds while the check still runs', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		vi.mocked(test_pinned.cached).mockResolvedValue({ ...EMPTY_REPORT, unpinned: [UNPINNED] })

		const answer = await run_review_pinned_join.wait_for_join(ROOT, undefined, true)

		expect(answer?.unpinned).toStrictEqual(
			test_pinned_record.summary_of({ ...EMPTY_REPORT, unpinned: [UNPINNED] }).unpinned,
		)
		expect(answer?.unpinned).toHaveLength(1)
		expect(answer).toMatchObject({ is_partial: true })
		expect(answer?.text).toContain('still running')
		expect(answer?.text).toContain(UNPINNED.file)
		expect(process.kill).not.toHaveBeenCalled()
	})

	it('says the check still runs when reading the cache failed', async () => {
		run_review_pinned_steps.launch(ROOT, REASON, FIXED_TREE)
		vi.mocked(test_pinned.cached).mockRejectedValue(GIT_FAILED)

		const answer = await run_review_pinned_join.wait_for_join(ROOT, undefined, true)

		expect(answer?.unpinned).toStrictEqual([])
		expect(answer?.text).toContain(FIXING_TEXT)
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

// joshuafolkken/kit#4920: a reason given after the join stopped judges the answer the check already left.
describe('run_review_pinned_join.finished_on_tree', () => {
	it('reads the answer left on the tree it was launched on, stopping and clearing nothing', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.finished_on_tree(ROOT)).toStrictEqual(ANSWER)
		expect(process.kill).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(FIXED_TREE)
	})

	it('answers none on a moved tree, so the open checks it again', async () => {
		run_review_pinned_steps.launch(ROOT, undefined, BRIEFED_TREE)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_join.finished_on_tree(ROOT)).toBeUndefined()
	})

	it('answers none for a check still running or never launched', async () => {
		expect(await run_review_pinned_join.finished_on_tree(ROOT)).toBeUndefined()

		run_review_pinned_steps.launch(ROOT, undefined, FIXED_TREE)

		expect(await run_review_pinned_join.finished_on_tree(ROOT)).toBeUndefined()
	})
})
