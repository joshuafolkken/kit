import { randomUUID } from 'node:crypto'
import { core_budget, type LiveReservation } from '#scripts/gate/core-budget'
import { process_identity } from '#scripts/josh/process-identity'
import { test_pinned_record } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4770: `josh run:review` launches `josh test:pinned --record` beside the pair, and
// `--join` waits on the answer it leaves.

const ROOT = `/nonexistent/run-review-pinned-${randomUUID()}`
const PID = 4770
const REASON = 'the branch only logs'
const PINNED_COMMAND = 'test:pinned'
const ORIGIN_ARGS = ['--origin', 'run-review']
const TIMED_OUT_NOTE = 'no answer within 120s of the gate and the review'
const STILL_RUNNING_NOTE =
	'it is still running on this tree; wait for its answer with `pnpm josh run:review --pinned`'
const ANSWER = { text: 'unpinned 1 · unchecked 0\n', unpinned: ['a.ts 0123456789abcdef'] }
const START = 'Sat Oct 24 21:00:00 2026'
const OTHER_START = 'Sun Oct 25 09:00:00 2026'
// Taken before any spy, so a test can run the real comparison against a stubbed start.
const { is_same_process } = process_identity
// The join's grace after the pair, in milliseconds.
const GRACE_MS = 120_000
const CAP_PASSED = GRACE_MS + 1

// A clock that reads 0 when the wait starts and past the grace on every read after it.
function capped_clock(): () => number {
	let reads = 0

	return function now(): number {
		reads += 1

		return reads === 1 ? 0 : CAP_PASSED
	}
}

// The token the last launch handed `josh test:pinned --record`.
function launched_token(): string {
	const [argv] = vi.mocked(run_review_steps.launch_josh).mock.lastCall ?? [[]]

	return String(argv.at(-1))
}

// A `test:pinned` claim in the core ledger, admitted or still queued.
function pinned_claim(checkout: string, admitted_at?: number): LiveReservation {
	const reservation = { pid: PID, weight: 1, claimed_at: 0, command: PINNED_COMMAND, checkout }

	return { key: 'claim', reservation: { ...reservation, admitted_at } }
}

beforeEach(() => {
	vi.spyOn(core_budget, 'live_reservations').mockReturnValue([])
	vi.spyOn(run_review_steps, 'launch_josh').mockReturnValue({ kind: 'launched', pid: PID })
	vi.spyOn(process_identity, 'read_start').mockReturnValue(START)
	// A wait that passes the grace signals `PID`'s group; no test may reach a real process.
	vi.spyOn(process, 'kill').mockReturnValue(true)
})

afterEach(() => {
	run_review_pinned_steps.clear(ROOT)
	vi.restoreAllMocks()
})

describe('run_review_pinned_steps.launch', () => {
	it('runs `josh test:pinned --record` in the background, logging beside the gate', () => {
		run_review_pinned_steps.launch(ROOT)

		expect(run_review_steps.launch_josh).toHaveBeenCalledWith(
			[PINNED_COMMAND, '--first-unpinned', ...ORIGIN_ARGS, '--record', expect.any(String)],
			run_review_pinned_steps.log_path(ROOT),
			ROOT,
		)
	})

	// joshuafolkken/kit#5153: a reason accepts the list as the whole answer, so every hunk is probed.
	it('probes every hunk under a reason', () => {
		run_review_pinned_steps.launch(ROOT, REASON)

		expect(run_review_steps.launch_josh).toHaveBeenCalledWith(
			[PINNED_COMMAND, ...ORIGIN_ARGS, '--record', expect.any(String)],
			run_review_pinned_steps.log_path(ROOT),
			ROOT,
		)
	})

	it('records no launch when it could not start, so the join waits on nothing', async () => {
		vi.mocked(run_review_steps.launch_josh).mockReturnValue({ kind: 'failed', note: 'busy' })

		run_review_pinned_steps.launch(ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toBeUndefined()
	})
})

// joshuafolkken/kit#4793: an `--unpinned-ok` open launches in the background too, so its reason rides
// on the launch record for the join to judge the answer by.
describe('run_review_pinned_steps.launched_reason', () => {
	it('reads back the reason the check was launched with', () => {
		run_review_pinned_steps.launch(ROOT, REASON)

		expect(run_review_pinned_steps.launched_reason(ROOT)).toBe(REASON)
	})

	it('answers none for a launch without a reason, and none once the next start clears it', () => {
		run_review_pinned_steps.launch(ROOT, REASON)
		run_review_pinned_steps.clear(ROOT)

		expect(run_review_pinned_steps.launched_reason(ROOT)).toBeUndefined()

		run_review_pinned_steps.launch(ROOT)

		expect(run_review_pinned_steps.launched_reason(ROOT)).toBeUndefined()
	})

	// joshuafolkken/kit#4920: a reason given after the check ended rides on its launch record.
	it('carries a later reason onto the launch, and onto none when nothing was launched', () => {
		run_review_pinned_steps.carry_reason(REASON, ROOT)

		expect(run_review_pinned_steps.launched_reason(ROOT)).toBeUndefined()

		run_review_pinned_steps.launch(ROOT, undefined, 'tree')
		run_review_pinned_steps.carry_reason(REASON, ROOT)

		expect(run_review_pinned_steps.launched_reason(ROOT)).toBe(REASON)
		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe('tree')
	})
})

// joshuafolkken/kit#4834: the launch records the tree it checks, so `review:record` tells a fix that
// moved it.
describe('run_review_pinned_steps.launched_tree', () => {
	it('reads back the tree the check was launched on, and none once the next start clears it', () => {
		const tree = 'tree-digest'

		run_review_pinned_steps.launch(ROOT, undefined, tree)

		expect(run_review_pinned_steps.launched_tree(ROOT)).toBe(tree)

		run_review_pinned_steps.clear(ROOT)

		expect(run_review_pinned_steps.launched_tree(ROOT)).toBeUndefined()
	})
})

describe('run_review_pinned_steps.wait_for_answer', () => {
	it('answers nothing when no check was launched', async () => {
		test_pinned_record.write('no-launch', ANSWER, ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toBeUndefined()
	})

	it("reads a launched check's answer", async () => {
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual(ANSWER)
	})

	it("never reads an earlier launch's answer as this launch's", async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write('earlier-launch', ANSWER, ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.unpinned).toStrictEqual([])
	})

	it('reads nothing of the last pair once a new start clears it', async () => {
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		run_review_pinned_steps.clear(ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toBeUndefined()
	})
})

describe('run_review_pinned_steps.wait_for_answer — late writes', () => {
	it("keeps this launch's answer when the last start's check writes after it", async () => {
		run_review_pinned_steps.launch(ROOT)
		const earlier = launched_token()

		run_review_pinned_steps.clear(ROOT)
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		test_pinned_record.write(earlier, test_pinned_record.not_run_summary('late'), ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual(ANSWER)
		test_pinned_record.clear(earlier, ROOT)
	})

	it('reads the answer a check wrote just before its process was found gone', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		vi.spyOn(test_pinned_record, 'read').mockReturnValueOnce(undefined)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual(ANSWER)
	})
})

describe('run_review_pinned_steps.wait_for_answer — failing open', () => {
	it('fails open on a check whose process ended without an answer', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
		run_review_pinned_steps.launch(ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual({
			text: '`josh test:pinned` could not run, so nothing was checked: its process ended without an answer\n',
			unpinned: [],
		})
	})

	it('fails open at once on a check whose pid was reissued to a process with another start', async () => {
		vi.mocked(run_review_steps.launch_josh).mockReturnValue({ kind: 'launched', pid: process.pid })
		vi.spyOn(process_identity, 'is_same_process').mockImplementation((pid, start) =>
			is_same_process(pid, start, () => OTHER_START),
		)
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.text).toContain('its process ended without an answer')
	})

	it('fails open on a check still running past the grace after the pair', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.unpinned).toStrictEqual([])
		expect(answer?.text).toContain(TIMED_OUT_NOTE)
	})
})

// joshuafolkken/kit#4888: a late check is left running on its tree, and the note names the one command
// that waits for its answer rather than asking for a run by hand.
describe('run_review_pinned_steps.wait_for_answer — a late check', () => {
	it.each([
		['is running', true],
		['has an unreadable start', undefined],
	])('leaves a check past the grace that %s running', async (_kind, is_same) => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(is_same)
		run_review_pinned_steps.launch(ROOT)

		await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(process.kill).not.toHaveBeenCalledWith(-PID, 'SIGTERM')
	})

	it('names `run:review --pinned` as the one command to wait on', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.text).toContain(STILL_RUNNING_NOTE)
	})
})

// Where no read follows (a ship's supervised join), a late check is stopped as before joshuafolkken/kit#4888.
describe('run_review_pinned_steps.wait_for_answer — stopping a late check nothing reads', () => {
	it("stops the check's whole process group once the grace has passed", async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		run_review_pinned_steps.launch(ROOT)

		await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock(), false)

		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})

	it('stops the late check even where its start time could not be read', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		run_review_pinned_steps.launch(ROOT)

		await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock(), false)

		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})
})

describe('run_review_pinned_steps.wait_for_answer — stopping a queued check nothing reads', () => {
	it('stops it without waiting out the grace and fails open', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		vi.mocked(core_budget.live_reservations).mockReturnValue([pinned_claim(ROOT)])
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(
			ROOT,
			vi.fn(() => 0),
			false,
		)

		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
		expect(answer).toStrictEqual({
			text: '`josh test:pinned` could not run, so nothing was checked: it was still waiting for cores when the gate and the review ended\n',
			unpinned: [],
		})
	})

	it('stops nothing when the check answered within the grace', async () => {
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer).toStrictEqual(ANSWER)
		expect(process.kill).not.toHaveBeenCalled()
	})

	it('signals nothing once the check is gone, so a reissued pid is never hit', async () => {
		const is_same = vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)

		is_same.mockReturnValueOnce(undefined)
		vi.spyOn(test_pinned_record, 'read').mockReturnValue(undefined)
		run_review_pinned_steps.launch(ROOT)

		await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(process.kill).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4828: a reopened pair stops the last check rather than leaving it running unowned.
describe('run_review_pinned_steps.clear — the last check', () => {
	it("stops the last check's process group while its pid still has the launch's start", () => {
		const is_same = vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)

		run_review_pinned_steps.launch(ROOT)
		run_review_pinned_steps.clear(ROOT)

		expect(is_same).toHaveBeenCalledWith(PID, START)
		expect(process.kill).toHaveBeenCalledWith(-PID, 'SIGTERM')
	})

	it('signals nothing once the last pid is reissued to a process with another start', () => {
		vi.mocked(run_review_steps.launch_josh).mockReturnValue({ kind: 'launched', pid: process.pid })
		vi.spyOn(process_identity, 'is_same_process').mockImplementation((pid, start) =>
			is_same_process(pid, start, () => OTHER_START),
		)

		run_review_pinned_steps.launch(ROOT)
		run_review_pinned_steps.clear(ROOT)

		// The liveness probe signals `0` to the pid itself; the group is never signalled.
		expect(process.kill).not.toHaveBeenCalledWith(-process.pid, 'SIGTERM')
	})

	it.each([
		['is gone', false],
		['has a start that could not be read', undefined],
	])('signals nothing when the last pid %s', (_kind, is_same) => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(is_same)
		run_review_pinned_steps.launch(ROOT)

		run_review_pinned_steps.clear(ROOT)

		expect(process.kill).not.toHaveBeenCalled()
	})

	it('signals nothing when no check was launched', () => {
		run_review_pinned_steps.clear(ROOT)

		expect(process.kill).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4808: a check still queued for its cores when the pair ends could not finish
// within the grace, so the join answers at once; it is left queued for `run:review --pinned`
// (joshuafolkken/kit#4888).
describe('run_review_pinned_steps.wait_for_answer — a check still queued for cores', () => {
	it('answers without waiting out the grace, leaving the check queued', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(true)
		vi.mocked(core_budget.live_reservations).mockReturnValue([pinned_claim(ROOT)])
		const now = vi.fn(() => 0)

		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, now)

		expect(now).not.toHaveBeenCalled()
		expect(process.kill).not.toHaveBeenCalledWith(-PID, 'SIGTERM')
		expect(answer).toStrictEqual({
			text: `\`josh test:pinned\` could not run, so nothing was checked: it was still waiting for cores when the gate and the review ended — ${STILL_RUNNING_NOTE}\n`,
			unpinned: [],
		})
	})

	it.each([
		['admitted, so already booting or running', pinned_claim(ROOT, 1)],
		["another checkout's, still queued", pinned_claim(`${ROOT}-other`)],
	])('waits out the grace on a claim %s', async (_kind, claim) => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		vi.mocked(core_budget.live_reservations).mockReturnValue([claim])
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.text).toContain(TIMED_OUT_NOTE)
	})

	it('reads the answer of a check that answered before the join, queued claim or not', async () => {
		vi.mocked(core_budget.live_reservations).mockReturnValue([pinned_claim(ROOT)])
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual(ANSWER)
		expect(process.kill).not.toHaveBeenCalled()
	})
})
