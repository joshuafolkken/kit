import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_GREEN, GATE_MOVED, run_review } from './run-review'
import { run_review_cli } from './run-review-cli'
import { run_review_pinned } from './run-review-pinned'
import { run_review_pinned_steps } from './run-review-pinned-steps'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#4774: a gate that passed before a review fix moved the tree is not reported red —
// neither the `Gate RED` note nor the gate's log, and its timing ends at its own green stamp.

const GATE_TAKEN_AT = '2026-09-23T10:40:07.855Z'
const GATE_LOG = '✔ verification gate passed (8 checks)'

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'wait_for_answer').mockResolvedValue(undefined)
	vi.spyOn(run_review_steps, 'wait_for_gate_finish').mockResolvedValue(GATE_MOVED)
	vi.spyOn(run_review_steps, 'read_gate_log').mockReturnValue(GATE_LOG)
	vi.spyOn(run_review_steps, 'complete_timing').mockReturnValue(undefined)
	vi.spyOn(review_stamps.gate_stamp, 'read').mockReturnValue({ taken_at: GATE_TAKEN_AT, files: {} })
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function printed(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

describe('run --join on a gate that passed before the tree moved', () => {
	it('exits with the moved code and says the gate passed, never Gate RED nor its log', async () => {
		expect(await run_review_cli.run(['--join'])).toBe(run_review.MOVED_EXIT_CODE)
		expect(printed()).toContain('Gate passed on an earlier tree')
		expect(printed()).not.toContain('Gate RED')
		expect(printed()).not.toContain(GATE_LOG)
	})

	it("ends the gate's timing at its green stamp, not at the join", async () => {
		await run_review_cli.run(['--join'])

		expect(run_review_steps.complete_timing).toHaveBeenCalledWith(
			expect.objectContaining({ gate_ended_at: GATE_TAKEN_AT }),
		)
	})
})

// joshuafolkken/kit#4770: the background `josh test:pinned` answers at the join, and an unpinned
// change stops the round whatever the gate answered.

const LIST = 'Unpinned: scripts/a.ts:3\n'

function errored(): string {
	return vi
		.mocked(process.stderr.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

describe('run --join on the background test:pinned', () => {
	beforeEach(() => {
		vi.spyOn(process.stderr, 'write').mockReturnValue(true)
	})

	it('exits with the unpinned code and prints the list with the stop note on a green gate', async () => {
		vi.mocked(run_review_steps.wait_for_gate_finish).mockResolvedValue(GATE_GREEN)
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned_count: 1,
		})

		expect(await run_review_cli.run(['--join'])).toBe(run_review.UNPINNED_EXIT_CODE)
		expect(errored()).toBe(`${LIST}${run_review_pinned.STOP_NOTE}\n`)
	})

	it('exits with the unpinned code on a moved gate too', async () => {
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned_count: 1,
		})

		expect(await run_review_cli.run(['--join'])).toBe(run_review.UNPINNED_EXIT_CODE)
	})

	it("keeps the gate's exit code and prints the clear answer when nothing is unpinned", async () => {
		vi.mocked(run_review_steps.wait_for_gate_finish).mockResolvedValue(GATE_GREEN)
		vi.mocked(run_review_pinned_steps.wait_for_answer).mockResolvedValue({
			text: LIST,
			unpinned_count: 0,
		})

		expect(await run_review_cli.run(['--join'])).toBe(0)
		expect(errored()).toBe(LIST)
	})
})
