import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_carry } from './run-carry'

const add_label_mock = vi.hoisted(() => vi.fn())
const remove_label_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: add_label_mock,
		issue_remove_label: remove_label_mock,
	},
}))

const { run_merge_steps } = await import('./run-merge-steps')

const CONTEXT = {
	child: '2070',
	epic: undefined,
	repo: undefined,
	over: 300_000,
	owner: run_carry.NO_OWNER,
}

beforeEach(() => {
	add_label_mock.mockReset()
	remove_label_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
})

describe('run_merge_steps.do_failed — parking is part of the result', () => {
	it('reports a failed needs-decision label write instead of treating the child as parked', async () => {
		add_label_mock.mockResolvedValue(false)

		expect(await run_merge_steps.do_failed(CONTEXT)).toStrictEqual({
			carry: undefined,
			is_parked: false,
		})
	})
})
