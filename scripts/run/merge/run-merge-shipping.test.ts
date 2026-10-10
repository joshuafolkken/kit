import { expect, it, vi } from 'vitest'
import { run_merge_token } from './run-merge-token'

const repository_mock = vi.hoisted(() => vi.fn())
const ship_result_mock = vi.hoisted(() => vi.fn())
const issue_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-common-directory', () => ({
	git_common_directory: { repository: repository_mock },
}))
vi.mock('#scripts/run/ship/run-ship-detach', () => ({
	run_ship_detach: { read_result: ship_result_mock },
}))
vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: issue_mock },
}))

const { run_merge_cli } = await import('./run-merge-cli')
const { MERGE_TOKEN } = run_merge_token

it('keeps a running detached ship in flight without classifying its issue', async () => {
	repository_mock.mockReturnValue(process.cwd())
	ship_result_mock.mockReturnValue({ launch_id: 'active', result: 'running' })

	const result = await run_merge_cli.merge_child({
		child: '2639',
		epic: undefined,
		repo: undefined,
		over: 1,
		owner: {},
	})

	expect(result.outcome).toBe('shipping')
	expect(result.token).toBe(MERGE_TOKEN.RESUMED)
	expect(issue_mock).not.toHaveBeenCalled()
})
