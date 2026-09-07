import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1535: git is mocked here because the assertions are about which ref this module
// hands `worktree add` and what it does when the fetch fails — `lane-open-start-point.test.ts` is
// the suite that proves the chosen ref actually carries the newer commit, against real git.
//
// The ref itself is resolved by `git_command.default_branch_reference`, which `change_base` shares, so
// what belongs here is the fetch around it and the fallback it reports.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		default_branch_reference: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
	},
}))

const { git_command } = await import('#scripts/git/git-command')
const { lane_start_point } = await import('./lane-start-point')

const MAIN = 'main'
const MAIN_TRACKING_REF = 'refs/remotes/origin/main'
const DEVELOP = 'develop'

const default_branch = vi.mocked(git_command.get_default_branch)
const fetch_branch = vi.mocked(git_command.fetch_branch)
const default_branch_reference = vi.mocked(git_command.default_branch_reference)

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	default_branch.mockResolvedValue(MAIN)
	fetch_branch.mockResolvedValue('')
	default_branch_reference.mockResolvedValue(MAIN_TRACKING_REF)
})

describe('resolving a lane start point', () => {
	it('cuts the lane from the ref the change base is measured against', async () => {
		expect(await lane_start_point.resolve()).toBe(MAIN_TRACKING_REF)
	})

	it('refreshes the remote-tracking ref before reading it', async () => {
		await lane_start_point.resolve()

		expect(fetch_branch).toHaveBeenCalledWith(MAIN)
	})

	// The fetch is what belongs to opening a lane; reading a diff must not perform one, which is why
	// the shared resolver does not and this module does.
	it('fetches before resolving, not after', async () => {
		const order: Array<string> = []

		fetch_branch.mockImplementation(async () => {
			order.push('fetch')

			return ''
		})
		default_branch_reference.mockImplementation(async () => {
			order.push('resolve')

			return MAIN_TRACKING_REF
		})

		await lane_start_point.resolve()

		expect(order).toStrictEqual(['fetch', 'resolve'])
	})

	it('follows the repository default branch rather than assuming main', async () => {
		default_branch.mockResolvedValue(DEVELOP)
		default_branch_reference.mockResolvedValue(`refs/remotes/origin/${DEVELOP}`)

		expect(await lane_start_point.resolve()).toBe(`refs/remotes/origin/${DEVELOP}`)
		expect(fetch_branch).toHaveBeenCalledWith(DEVELOP)
	})
})

describe('degrading when the remote is out of reach', () => {
	// The lane still has to open with no network at all; what it loses is the refresh, not the ref.
	it('opens from the remote-tracking ref as it stands when the fetch fails', async () => {
		fetch_branch.mockRejectedValue(new Error('ssh: connect to host github.com port 22'))

		expect(await lane_start_point.resolve()).toBe(MAIN_TRACKING_REF)
	})

	it('says on stderr that the fetch did not happen', async () => {
		fetch_branch.mockRejectedValue(new Error('offline'))

		await lane_start_point.resolve()

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`origin/${MAIN}`))
	})

	it('falls back to the local branch where there is no remote-tracking ref at all', async () => {
		default_branch_reference.mockResolvedValue(MAIN)

		expect(await lane_start_point.resolve()).toBe(MAIN)
	})

	// The fallback is the stale reading this module exists to avoid, and the resolver answers the
	// same bare name for a git failure as for a repository with no remote — so it has to be said.
	it('says on stderr that the lane is being cut from the local branch', async () => {
		default_branch_reference.mockResolvedValue(MAIN)

		await lane_start_point.resolve()

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(MAIN_TRACKING_REF))
	})
})
