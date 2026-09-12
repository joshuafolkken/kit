import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import { main_sync } from '#scripts/git/main-sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observations_flush } from './observations-flush'
import {
	DEFAULT_BRANCH,
	FLUSH_BRANCH,
	MODIFIED_LEDGER,
	MORNING_INSTANT,
	MS_COMMAND,
	ONLY_COPY,
} from './observations-flush-fixture'

// joshuafolkken/kit#1785: a commit rejected by the pre-commit hook used to leave the flush branch
// behind with no commit on it, and the refusal the next run printed named two exits — finish that
// branch, or delete it — that the distributed `.claude/settings.json` denies outright. What is pinned
// here is the rollback, which is the half the messages cannot pin: the side that created the branch
// removes it, the checkout goes back, and the appended lines stay in the working tree.
//
// `git_command` is mocked because the assertions are about the order this module drives git in, not
// about git itself — the flags of each call belong to `git-command`'s own tests.

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		add_path: vi.fn(),
		branch: vi.fn(),
		checkout: vi.fn(),
		checkout_b: vi.fn(),
		commit: vi.fn(),
		commit_count_beyond: vi.fn(),
		delete_branch: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
		push: vi.fn(),
		status: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: { pr_create: vi.fn(), pr_merge: vi.fn() },
}))
vi.mock('#scripts/git/git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))
vi.mock('#scripts/git/main-sync', () => ({ main_sync: { run: vi.fn() } }))

const HOOK_REJECTION = 'cspell found an unknown word'
const CHECKOUT_FAILURE = 'index.lock exists'
const PULL_REQUEST_URL = 'https://github.com/joshuafolkken/kit/pull/1'
const NO_COMMITS = 0
const SUCCESS_EXIT_CODE = 0

function on_default_branch(): void {
	vi.mocked(git_command.status).mockResolvedValue(MODIFIED_LEDGER)
	vi.mocked(git_command.branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_command.get_default_branch).mockResolvedValue(DEFAULT_BRANCH)
	// The default branch is up to date, so the freshness gate passes and a branch is cut.
	vi.mocked(git_command.fetch_branch).mockResolvedValue('')
	vi.mocked(git_command.commit_count_beyond).mockResolvedValue(NO_COMMITS)
	vi.mocked(git_command.checkout_b).mockResolvedValue('')
	vi.mocked(git_command.checkout).mockResolvedValue('')
	vi.mocked(git_gh_command.pr_create).mockResolvedValue(PULL_REQUEST_URL)
	vi.mocked(main_sync.run).mockResolvedValue(SUCCESS_EXIT_CODE)
}

// The message the command exits with, whichever side it came out of — so an arm can be asserted by
// what it says *and* by what it does not, which a bare `rejects.toThrow` substring cannot do.
async function flush_message(): Promise<string> {
	try {
		return await observations_flush.flush(new Date(MORNING_INSTANT))
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

async function rejected_flush(): Promise<string> {
	vi.mocked(git_command.commit).mockRejectedValue(new Error(HOOK_REJECTION))

	return await flush_message()
}

describe('observations_flush — a commit the pre-commit hook rejects', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('returns the checkout to the branch the flush started from', async () => {
		await rejected_flush()

		expect(git_command.checkout).toHaveBeenCalledWith(DEFAULT_BRANCH)
	})

	// The orphan branch is the whole defect: five of them were sitting in the checkout that filed
	// this issue, each one a flush whose commit was rejected.
	it('deletes the branch it had just created', async () => {
		await rejected_flush()

		expect(git_command.delete_branch).toHaveBeenCalledWith(FLUSH_BRANCH)
	})

	it('never reaches the push', async () => {
		await rejected_flush()

		expect(git_command.push).not.toHaveBeenCalled()
	})

	// The appended lines are staged and uncommitted throughout, so the rollback loses nothing and the
	// message says so rather than warning about a copy that does not exist.
	it('says the appended lines are still in the working tree', async () => {
		const message = await rejected_flush()

		expect(message).toContain('still in the working tree')
		expect(message).toContain(HOOK_REJECTION)
		expect(message).not.toContain('only copy')
	})

	// The acceptance criterion the refusal used to break: with the branch gone and the checkout back
	// on the default branch, the very next flush is a fresh branch rather than a refusal.
	it('leaves the same command runnable immediately afterwards', async () => {
		await rejected_flush()
		vi.mocked(git_command.commit).mockResolvedValue(undefined)

		await expect(observations_flush.flush(new Date(MORNING_INSTANT))).resolves.toContain(
			FLUSH_BRANCH,
		)
	})
})

describe('observations_flush — a rollback that cannot finish', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
		vi.mocked(git_command.checkout).mockRejectedValue(new Error(CHECKOUT_FAILURE))
	})

	// The branch is still in the checkout, so a message asserting its removal would send somebody
	// looking for something that is still there. Both reasons ride in the one error instead.
	it('reports both reasons and claims no removal', async () => {
		const message = await rejected_flush()

		expect(message).toContain(HOOK_REJECTION)
		expect(message).toContain(CHECKOUT_FAILURE)
		expect(message).not.toContain('was removed')
	})
})

describe('observations_flush — a default branch behind origin', () => {
	const COMMITS_BEHIND = 3

	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
		vi.mocked(git_command.commit_count_beyond).mockResolvedValue(COMMITS_BEHIND)
	})

	// joshuafolkken/kit#1768: the branch cut from a stale default branch conflicts by construction, so
	// the flush refuses before cutting one and names the command that brings the start point current.
	it('refuses before cutting a branch and names pnpm josh ms', async () => {
		const message = await flush_message()

		expect(message).toContain(MS_COMMAND)
		expect(message).not.toContain(ONLY_COPY)
		expect(git_command.checkout_b).not.toHaveBeenCalled()
	})

	// The acceptance criterion the fix turns on: the ledger is dirty when this runs, so the refusal
	// must read the remote and write nothing — no commit, no staging, no push.
	it('does not touch the working tree while the ledger is dirty', async () => {
		await flush_message()

		expect(git_command.commit).not.toHaveBeenCalled()
		expect(git_command.add_path).not.toHaveBeenCalled()
		expect(git_command.push).not.toHaveBeenCalled()
	})
})

describe('observations_flush — a flush branch that is still in the checkout', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
		vi.mocked(git_command.branch).mockResolvedValue(FLUSH_BRANCH)
	})

	// **Both assertions are load-bearing**: the stranded message names `pnpm josh ms` too, so a
	// positive match alone passes with the two arms swapped.
	it('tells a zero-commit branch to return to the default branch and flush again', async () => {
		vi.mocked(git_command.commit_count_beyond).mockResolvedValue(NO_COMMITS)

		const message = await flush_message()

		expect(message).toContain(MS_COMMAND)
		expect(message).not.toContain(ONLY_COPY)
	})

	// A count nobody could read must not be reported as "nothing is stranded": that answer is the one
	// that loses lines, so an unreadable count takes the warning arm.
	it('warns about the only copy when the commit count cannot be read', async () => {
		vi.mocked(git_command.commit_count_beyond).mockRejectedValue(new Error('unknown revision'))

		await expect(flush_message()).resolves.toContain(ONLY_COPY)
	})
})
