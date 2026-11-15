import { beforeEach, describe, expect, it, vi } from 'vitest'

const josh_run_mock = vi.hoisted(() => vi.fn())
const is_linked_mock = vi.hoisted(() => vi.fn())
const branch_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/josh/josh-run', () => ({ josh_command: { josh_run: josh_run_mock } }))
vi.mock('#scripts/git/git-worktree', () => ({ git_worktree: { is_linked: is_linked_mock } }))
vi.mock('#scripts/git/git-command', () => ({ git_command: { branch: branch_mock } }))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: vi.fn(() => false) },
}))

const { run_entry_sync } = await import('./run-entry-sync')

const ISSUE = '7543'
const ENTRY = { issue_number: ISSUE, command: 'fullrun', is_adopt: false }
const CLEAN = { code: 0, out: 'clean' }
const SYNCED = { code: 0, out: 'main' }

function sync_call(): unknown {
	return josh_run_mock.mock.calls[1]?.[0]
}

beforeEach(() => {
	josh_run_mock.mockReset().mockResolvedValueOnce(CLEAN).mockResolvedValueOnce(SYNCED)
	is_linked_mock.mockReset().mockResolvedValue(false)
	branch_mock.mockReset()
})

// joshuafolkken/kit#7543: the hold taken on the issue's own branch to resume a returned pull request
// was followed by `main:sync`, which checked out the default branch under it.
describe('a primary checkout on the issue’s own branch is merged in place', () => {
	it('merges the default branch rather than checking it out', async () => {
		branch_mock.mockResolvedValue(`${ISSUE}-fix-the-returned-pull-request`)

		expect(await run_entry_sync.sync(ENTRY)).toBeUndefined()
		expect(sync_call()).toStrictEqual(['main:merge'])
	})

	it.each([['main'], ['7542-another-issue'], ['75430-a-longer-number']])(
		'still synchronizes the tree from %j',
		async (branch) => {
			branch_mock.mockResolvedValue(branch)

			await run_entry_sync.sync(ENTRY)

			expect(sync_call()).toStrictEqual(['main:sync'])
		},
	)
})
