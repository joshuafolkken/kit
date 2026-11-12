import { run_carry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#5841: `run:merge --stash` stashes a stopped unit's work before the child is read and
// classified, so the classification never acts on a lane whose half-finished work is not yet kept.

const calls = vi.hoisted((): Array<string> => [])
const stash_mock = vi.hoisted(() => vi.fn())
const read_issue_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-merge-steps', () => ({ run_merge_steps: { stash_stopped: stash_mock } }))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_issue_mock },
}))
vi.mock('#scripts/lane/lane-handoff', () => ({
	lane_handoff: { is_ship_running: vi.fn().mockReturnValue(false) },
}))

const { run_merge_cli } = await import('./run-merge-cli')

const READ_STOP = 'read stops the merge here'
const CONTEXT = {
	child: '5841',
	epic: undefined,
	repo: undefined,
	over: true as const,
	owner: run_carry.NO_OWNER,
}

beforeEach(() => {
	calls.length = 0
	stash_mock.mockReset().mockImplementation(async () => {
		await Promise.resolve()
		calls.push('stash')
	})
	read_issue_mock.mockReset().mockImplementation(async () => {
		await Promise.resolve()
		calls.push('read')
		throw new Error(READ_STOP)
	})
})

describe('run_merge_cli.merge_child — --stash', () => {
	it('stashes the stopped unit before reading the child to classify it', async () => {
		await expect(run_merge_cli.merge_child({ ...CONTEXT, stash: true })).rejects.toThrow(READ_STOP)
		expect(stash_mock).toHaveBeenCalledWith(CONTEXT.child)
		expect(calls).toStrictEqual(['stash', 'read'])
	})

	it('stashes nothing without --stash', async () => {
		await expect(run_merge_cli.merge_child(CONTEXT)).rejects.toThrow(READ_STOP)
		expect(stash_mock).not.toHaveBeenCalled()
	})
})
