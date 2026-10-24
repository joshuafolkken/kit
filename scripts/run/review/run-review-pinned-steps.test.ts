import { randomUUID } from 'node:crypto'
import { process_identity } from '#scripts/josh/process-identity'
import { test_pinned_record } from '#scripts/test/test-pinned-record'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4770: `josh run:review` launches `josh test:pinned --record` beside the pair, and
// `--join` waits on the answer it leaves.

const ROOT = `/nonexistent/run-review-pinned-${randomUUID()}`
const PID = 4770
const ANSWER = { text: 'unpinned 1 · unchecked 0\n', unpinned_count: 1 }
const CAP_PASSED = run_review_steps.MAX_JOIN_WAIT_MS + 1

// A clock that reads 0 when the wait starts and past the cap on every read after it.
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

beforeEach(() => {
	vi.spyOn(run_review_steps, 'launch_josh').mockReturnValue({ kind: 'launched', pid: PID })
})

afterEach(() => {
	run_review_pinned_steps.clear(ROOT)
	vi.restoreAllMocks()
})

describe('run_review_pinned_steps.launch', () => {
	it('runs `josh test:pinned --record` in the background, logging beside the gate', () => {
		run_review_pinned_steps.launch(ROOT)

		expect(run_review_steps.launch_josh).toHaveBeenCalledWith(
			['test:pinned', '--record', expect.any(String)],
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

		expect(answer?.unpinned_count).toBe(0)
	})

	it('reads nothing of the last pair once a new start clears it', async () => {
		run_review_pinned_steps.launch(ROOT)
		test_pinned_record.write(launched_token(), ANSWER, ROOT)
		run_review_pinned_steps.clear(ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toBeUndefined()
	})
})

describe('run_review_pinned_steps.wait_for_answer — failing open', () => {
	it('fails open on a check whose process ended without an answer', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(false)
		run_review_pinned_steps.launch(ROOT)

		expect(await run_review_pinned_steps.wait_for_answer(ROOT)).toStrictEqual({
			text: '`josh test:pinned` could not run, so nothing was checked: its process ended without an answer\n',
			unpinned_count: 0,
		})
	})

	it('fails open on a check still running past the cap', async () => {
		vi.spyOn(process_identity, 'is_same_process').mockReturnValue(undefined)
		run_review_pinned_steps.launch(ROOT)

		const answer = await run_review_pinned_steps.wait_for_answer(ROOT, capped_clock())

		expect(answer?.unpinned_count).toBe(0)
		expect(answer?.text).toContain('no answer within 600s')
	})
})
