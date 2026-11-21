import { beforeEach, describe, expect, it, vi } from 'vitest'

const count_mock = vi.hoisted(() => vi.fn<(base: string, tip: string) => Promise<number>>())
const fetch_mock = vi.hoisted(() => vi.fn<(branch: string) => Promise<string>>())

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		get_default_branch: async () => 'main',
		commit_count_beyond: count_mock,
		fetch_branch: fetch_mock,
	},
}))

const { run_ship_behind_default } = await import('./run-ship-behind-default')

const MOVED = 3
const UNREADABLE = new Error('git rev-list failed')

beforeEach(() => {
	count_mock.mockReset().mockResolvedValue(0)
	fetch_mock.mockReset().mockResolvedValue('')
})

// joshuafolkken/kit#8304: the preflight leaves the scoped pair to the merged tree only when the sync
// stage will merge a default branch that moved.
describe('run_ship_behind_default.is_merge_ahead', () => {
	it('fetches the default branch, then counts the commits the branch lacks', async () => {
		count_mock.mockResolvedValue(MOVED)

		expect(await run_ship_behind_default.is_merge_ahead()).toBe(true)
		expect(fetch_mock).toHaveBeenCalledWith('main')
		expect(count_mock).toHaveBeenCalledWith('HEAD', 'origin/main')
		expect(fetch_mock.mock.invocationCallOrder[0]).toBeLessThan(
			count_mock.mock.invocationCallOrder[0] ?? 0,
		)
	})

	it('answers no when the default branch has not moved', async () => {
		expect(await run_ship_behind_default.is_merge_ahead()).toBe(false)
	})

	it('answers no when the fetch fails, so the caller keeps its work', async () => {
		fetch_mock.mockRejectedValue(UNREADABLE)
		count_mock.mockResolvedValue(MOVED)

		expect(await run_ship_behind_default.is_merge_ahead()).toBe(false)
	})
})

describe('run_ship_behind_default.is_behind_default', () => {
	it('reads the remote-tracking ref without fetching', async () => {
		count_mock.mockResolvedValue(MOVED)

		expect(await run_ship_behind_default.is_behind_default()).toBe(true)
		expect(fetch_mock).not.toHaveBeenCalled()
	})

	it('answers no when the branch holds every default-branch commit', async () => {
		expect(await run_ship_behind_default.is_behind_default()).toBe(false)
	})

	it('reads an unreadable count as moved', async () => {
		count_mock.mockRejectedValue(UNREADABLE)

		expect(await run_ship_behind_default.is_behind_default()).toBe(true)
	})
})
