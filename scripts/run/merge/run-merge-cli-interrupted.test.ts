import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_merge_token } from './run-merge-token'

// joshuafolkken/kit#3884: a unit killed with the session that ran it is released to be dispatched again
// — not counted as a failure, not parked.

const release_mock = vi.hoisted(() => vi.fn())
const do_failed_mock = vi.hoisted(() => vi.fn())
const do_outage_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: {
		read_issue: vi.fn().mockResolvedValue({
			kind: 'state',
			state: { state: 'OPEN', labels: ['in-progress'] },
		}),
	},
}))

vi.mock('#scripts/issue/issue-closing-pr', () => ({
	issue_closing_pr: { read_closing_pr: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-ending', () => ({ run_ending: { read_exit: vi.fn() } }))

vi.mock('./run-merge-steps', () => ({
	run_merge_steps: {
		ask_next: vi.fn().mockResolvedValue('2039'),
		do_failed: do_failed_mock,
		do_outage: do_outage_mock,
		has_resumable_cut: vi.fn().mockResolvedValue(false),
	},
}))

vi.mock('./run-merge-interrupt', () => ({
	run_merge_interrupt: { is_interrupted: vi.fn().mockResolvedValue(true), release: release_mock },
}))

const { run_merge_cli } = await import('./run-merge-cli')

const ARGS = ['3884', '--output', 'child.jsonl']
const SUCCESS = 0
const FAILURE = 1

beforeEach(() => {
	release_mock.mockReset().mockResolvedValue(undefined)
	do_failed_mock.mockReset()
	do_outage_mock.mockReset()

	vi.spyOn(console, 'info').mockImplementation(info_mock.mockReset())
})

describe('run_merge_cli.run — an interrupted unit', () => {
	it('releases an interrupted child and offers the next without counting a failure', async () => {
		expect(await run_merge_cli.run(ARGS)).toBe(SUCCESS)
		expect(release_mock).toHaveBeenCalledOnce()
		expect(do_failed_mock).not.toHaveBeenCalled()
		expect(do_outage_mock).not.toHaveBeenCalled()
		expect(info_mock).toHaveBeenCalledWith('2039')
	})

	it('emits busy when this session does not own the carry record', async () => {
		release_mock.mockResolvedValue({ failures: 0, owner_pid: 99_999 })
		vi.spyOn(console, 'error').mockImplementation(vi.fn())

		expect(await run_merge_cli.run(ARGS)).toBe(FAILURE)
		expect(info_mock).toHaveBeenCalledWith(run_merge_token.MERGE_TOKEN.BUSY)
	})
})
