import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_RUNNING } from './run-review'
import { run_review_cli } from './run-review-cli'
import { run_review_join_read } from './run-review-join-read'
import { run_review_join_ready } from './run-review-join-ready'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#8309: a gate still running at the join's wait cap returns `pending` before the
// prompt cache expires — never green, never red, and with nothing judged, timed or read.

const PENDING_EXIT_CODE = 4

beforeEach(() => {
	vi.spyOn(run_review_join_ready, 'read').mockResolvedValue(undefined)
	vi.spyOn(run_review_join_ready, 'gate_state').mockResolvedValue(GATE_RUNNING)
	vi.spyOn(run_review_join_ready, 'verdict').mockResolvedValue(undefined)
	vi.spyOn(run_review_join_read, 'read').mockResolvedValue(undefined)
	vi.spyOn(run_review_steps, 'complete_timing').mockReturnValue(undefined)
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

describe('run --join on a gate still running at the wait cap', () => {
	it.each([
		[['--join', '--chunk'], false],
		[['--join', '--fixing', '--chunk'], true],
	])('exits pending and names the same command for %j', async (argv, is_fixing) => {
		expect(await run_review_cli.run(argv)).toBe(PENDING_EXIT_CODE)
		expect(run_review_join_ready.gate_state).toHaveBeenCalledWith(undefined, true)
		expect(run_review_join_ready.read).toHaveBeenCalledWith(is_fixing)
		expect(printed()).toContain('pending — the gate is still running')
		expect(printed()).toContain('re-run the same command')
		expect(printed()).not.toContain('Gate RED')
	})

	it('neither times the pair nor reads test:pinned, so the join stays due', async () => {
		await run_review_cli.run(['--join', '--chunk'])

		expect(run_review_steps.complete_timing).not.toHaveBeenCalled()
		expect(run_review_join_ready.verdict).not.toHaveBeenCalled()
	})
})
