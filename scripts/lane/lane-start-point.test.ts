import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#1535: git is mocked here because the assertions are about which ref this module
// hands `worktree add` and what it does when the fetch fails — `lane-open-start-point.test.ts` is
// the suite that proves the chosen ref actually carries the newer commit, against real git.
//
// The ref itself is resolved by `git_command.default_branch_reference`, which `change_base` shares, so
// what belongs here is the fetch around it and the fallback it reports.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch_exists: vi.fn(),
		branch_names_remote: vi.fn(),
		ls_remote_branch: vi.fn(),
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
const branch_exists = vi.mocked(git_command.branch_exists)
const branch_names_remote = vi.mocked(git_command.branch_names_remote)
const ls_remote_branch = vi.mocked(git_command.ls_remote_branch)

const LANE_BRANCH = '1446-lane'
const LANE_TRACKING_REF = 'refs/remotes/origin/1446-lane'
const OFFLINE_MESSAGE = 'ssh: connect to host github.com port 22'
const LANE_REMOTE_NAME = `origin/${LANE_BRANCH}`
const LANE_HEAD = 'aa11bb22cc33\trefs/heads/1446-lane'

// The remote has the branch and this checkout already tracks it: the ordinary shape of a child
// parked after pushing, on the machine that pushed it.
function remote_carries_the_branch(): void {
	ls_remote_branch.mockResolvedValue(LANE_HEAD)
	branch_names_remote.mockResolvedValue([LANE_REMOTE_NAME])
}

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	default_branch.mockResolvedValue(MAIN)
	fetch_branch.mockResolvedValue('')
	default_branch_reference.mockResolvedValue(MAIN_TRACKING_REF)
	branch_exists.mockResolvedValue(false)
	branch_names_remote.mockResolvedValue([])
	ls_remote_branch.mockResolvedValue('')
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
		fetch_branch.mockRejectedValue(new Error(OFFLINE_MESSAGE))

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

// joshuafolkken/kit#1627: a child parked after pushing leaves `<N>-lane` behind — locally, on the
// remote, or on the remote alone once `lane:close` has run `git branch -D`. Reopening its lane has
// to land on those commits; cutting a fresh branch of the same name orphaned them silently.
describe('resolving the start point when the lane branch already exists', () => {
	it('attaches to the local branch rather than naming a start point', async () => {
		branch_exists.mockResolvedValue(true)

		expect(await lane_start_point.resolve_for_branch(LANE_BRANCH)).toBeUndefined()
	})

	it('says on stderr that the local branch is being reused', async () => {
		branch_exists.mockResolvedValue(true)

		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(LANE_BRANCH))
	})

	// The default branch's own fetch belongs to cutting a new lane; an attach is not cutting one.
	it('does not go looking for the default branch when the local one is there', async () => {
		branch_exists.mockResolvedValue(true)

		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(default_branch_reference).not.toHaveBeenCalled()
	})

	it('cuts from the remote-tracking ref when only the remote has the branch', async () => {
		remote_carries_the_branch()

		expect(await lane_start_point.resolve_for_branch(LANE_BRANCH)).toBe(LANE_TRACKING_REF)
	})

	it('says on stderr that the remote branch is being reused', async () => {
		remote_carries_the_branch()

		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('origin'))
	})

	// The ref this checkout holds may be behind the branch — a review commit pushed from elsewhere —
	// and a lane started behind it has its own push refused as non-fast-forward.
	it('fetches the lane branch before reading the ref, so the lane starts at the tip', async () => {
		remote_carries_the_branch()

		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(fetch_branch).toHaveBeenCalledWith(LANE_BRANCH)
	})
})

// The remote-tracking ref outlives the branch it names: `lane:close` deletes the local branch and
// GitHub deletes the remote one at the merge, and nothing prunes what is left. This checkout carried
// sixteen such refs (joshuafolkken/kit#1627), so reading one as "the work is on origin" would cut a
// lane from a commit merged long ago — the staleness joshuafolkken/kit#1535 removed, by another route.
describe('resolving the start point when the remote no longer has the branch', () => {
	it('ignores a remote-tracking ref whose branch origin has deleted', async () => {
		branch_names_remote.mockResolvedValue([LANE_REMOTE_NAME])

		expect(await lane_start_point.resolve_for_branch(LANE_BRANCH)).toBe(MAIN_TRACKING_REF)
	})

	it('reports no reuse for a ref it refused', async () => {
		branch_names_remote.mockResolvedValue([LANE_REMOTE_NAME])

		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Reusing'))
	})

	// A checkout that has never seen the branch has no ref to fall back on, so a fall-through would
	// cut `<N>-lane` fresh over commits origin demonstrably has. Refusing is the explicit report the
	// Issue asks for in place of a silent new branch.
	it('refuses the open when origin has the branch but it could not be fetched', async () => {
		ls_remote_branch.mockResolvedValue(LANE_HEAD)
		fetch_branch.mockRejectedValue(new Error(OFFLINE_MESSAGE))

		await expect(lane_start_point.resolve_for_branch(LANE_BRANCH)).rejects.toThrow(
			/could not be fetched/u,
		)
	})

	// Offline is not the same answer, and resolving it the same way would cut a fresh branch over
	// commits somebody pushed — the silent failure this module exists to remove.
	it('still reuses the ref when origin cannot be reached, and says it could not check', async () => {
		ls_remote_branch.mockRejectedValue(new Error(OFFLINE_MESSAGE))
		branch_names_remote.mockResolvedValue([LANE_REMOTE_NAME])

		expect(await lane_start_point.resolve_for_branch(LANE_BRANCH)).toBe(LANE_TRACKING_REF)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Could not refresh'))
	})
})

describe('resolving the start point when no such branch exists', () => {
	it('cuts a new lane from the default branch, exactly as before', async () => {
		expect(await lane_start_point.resolve_for_branch(LANE_BRANCH)).toBe(MAIN_TRACKING_REF)
	})

	it('reports no reuse, so a new lane is not mistaken for a resumed one', async () => {
		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining(LANE_BRANCH))
	})

	// With nothing to reuse there is nothing to fetch either, so a lane for a brand-new child costs
	// one `ls-remote` and the default branch's own refresh — not a fetch of a branch nobody pushed.
	it('does not fetch a lane branch the remote does not have', async () => {
		await lane_start_point.resolve_for_branch(LANE_BRANCH)

		expect(fetch_branch).not.toHaveBeenCalledWith(LANE_BRANCH)
	})
})
