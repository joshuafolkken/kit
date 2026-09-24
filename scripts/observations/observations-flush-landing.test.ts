import { git_command } from '#scripts/git/git-command'
import { git_gh_command } from '#scripts/git/git-gh-command'
import type { OpenPull } from '#scripts/git/git-gh-pr-auto-merge'
import { git_pr_checks } from '#scripts/git/git-pr-checks'
import { main_sync } from '#scripts/git/main-sync'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observations_flush } from './observations-flush'
import {
	DEFAULT_BRANCH,
	FLUSH_BRANCH,
	MODIFIED_LEDGER,
	MORNING_INSTANT,
} from './observations-flush-fixture'
import { observations_flush_landing } from './observations-flush-landing'

// joshuafolkken/kit#2497. A flush pull request used to merge only inside the flush's own wait, so a
// wait that ended early left it open with nobody to merge it. These drive `flush()` against a mocked
// git and GitHub, the harness `observations-flush-command.test.ts` uses, and pin the two halves of the
// fix: auto-merge is requested before the wait, and an earlier flush left open is noticed.
vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		add_path: vi.fn(),
		branch: vi.fn(),
		checkout: vi.fn(),
		checkout_b: vi.fn(),
		commit: vi.fn(),
		commit_count_beyond: vi.fn(),
		fast_forward_local: vi.fn(),
		fetch_branch: vi.fn(),
		get_default_branch: vi.fn(),
		push: vi.fn(),
		status: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-gh-command', () => ({
	git_gh_command: {
		pr_create: vi.fn(),
		pr_enable_auto_merge: vi.fn(),
		pr_list_open_with_head_prefix: vi.fn(),
		pr_merge: vi.fn(),
	},
}))
vi.mock('#scripts/git/git-pr-checks', () => ({
	git_pr_checks: {
		read_merge_progress: vi.fn(),
		wait_for_pr_merged: vi.fn(),
		wait_for_pr_success: vi.fn(),
	},
}))
vi.mock('#scripts/git/main-sync', () => ({ main_sync: { run: vi.fn() } }))

const NO_COMMITS = 0
const SUCCESS_EXIT_CODE = 0
const WAIT_INTERRUPTED = 'the wait was interrupted'
const GRAPHQL_FORBIDDEN = 'gh: Resource not accessible by integration (HTTP 403)'
const LANDING_PULL: OpenPull = {
	number: 2479,
	head_ref: 'observations/2026-09-23-160000',
	has_auto_merge: true,
}
const STUCK_PULL: OpenPull = {
	number: 2469,
	head_ref: 'observations/2026-09-23-153650',
	has_auto_merge: false,
}

function on_default_branch(): void {
	vi.mocked(git_command.status).mockResolvedValue(MODIFIED_LEDGER)
	vi.mocked(git_command.branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_command.get_default_branch).mockResolvedValue(DEFAULT_BRANCH)
	vi.mocked(git_command.fetch_branch).mockResolvedValue('')
	vi.mocked(git_command.commit_count_beyond).mockResolvedValue(NO_COMMITS)
	vi.mocked(git_command.checkout_b).mockResolvedValue('')
	vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([])
	vi.mocked(git_pr_checks.wait_for_pr_merged).mockResolvedValue('merged')
	vi.mocked(git_pr_checks.read_merge_progress).mockResolvedValue('waiting')
	vi.mocked(main_sync.run).mockResolvedValue(SUCCESS_EXIT_CODE)
}

async function flush_message(): Promise<string> {
	try {
		return await observations_flush.flush(new Date(MORNING_INSTANT))
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
}

function first_call_order(command: (...args: Array<never>) => unknown): number {
	return vi.mocked(command).mock.invocationCallOrder[0] ?? NaN
}

describe('observations_flush — auto-merge', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('requests auto-merge on the flush branch before it starts waiting', async () => {
		await flush_message()

		expect(git_gh_command.pr_enable_auto_merge).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(first_call_order(git_gh_command.pr_enable_auto_merge)).toBeLessThan(
			first_call_order(git_pr_checks.wait_for_pr_merged),
		)
	})

	it('has already requested auto-merge when the wait is interrupted, so GitHub still lands it', async () => {
		vi.mocked(git_pr_checks.wait_for_pr_merged).mockRejectedValue(new Error(WAIT_INTERRUPTED))

		const message = await flush_message()

		expect(git_gh_command.pr_enable_auto_merge).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(message).toContain(WAIT_INTERRUPTED)
		expect(message).toContain(FLUSH_BRANCH)
	})
})

describe('observations_flush — an auto-merge that does not land', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('reports a merge wait that ran out rather than claiming the merge', async () => {
		vi.mocked(git_pr_checks.wait_for_pr_merged).mockResolvedValue('waiting')

		const message = await flush_message()

		expect(message).toContain(observations_flush_landing.MERGE_TIMEOUT_REASON)
		expect(main_sync.run).not.toHaveBeenCalled()
	})

	it('reports a pull request the checks failed rather than claiming the merge', async () => {
		vi.mocked(git_pr_checks.wait_for_pr_merged).mockResolvedValue('failed')

		const message = await flush_message()

		expect(message).toContain(observations_flush_landing.MERGE_FAILED_REASON)
		expect(main_sync.run).not.toHaveBeenCalled()
	})

	it('falls back to waiting on the checks and merging itself when auto-merge is refused', async () => {
		vi.mocked(git_gh_command.pr_enable_auto_merge).mockRejectedValue(new Error(GRAPHQL_FORBIDDEN))
		vi.spyOn(console, 'warn').mockReturnValue(undefined)

		const message = await flush_message()

		expect(git_pr_checks.wait_for_pr_success).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(git_gh_command.pr_merge).toHaveBeenCalledWith(FLUSH_BRANCH)
		expect(git_pr_checks.wait_for_pr_merged).not.toHaveBeenCalled()
		expect(message).toBe(observations_flush.merged_message(FLUSH_BRANCH))
	})
})

describe('observations_flush — an earlier flush pull request still open', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		on_default_branch()
	})

	it('refuses by name when one will never land by itself, before cutting a branch', async () => {
		vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([
			LANDING_PULL,
			STUCK_PULL,
		])

		const message = await flush_message()

		expect(message).toBe(observations_flush_landing.stuck_flush_message([STUCK_PULL]))
		expect(message).toContain('#2469')
		expect(message).toContain(STUCK_PULL.head_ref)
		expect(git_command.checkout_b).not.toHaveBeenCalled()
	})

	it('defers to one that is still landing with auto-merge, leaving the lines in the tree', async () => {
		vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([LANDING_PULL])

		const message = await flush_message()

		expect(message).toBe(observations_flush_landing.landing_flush_message([LANDING_PULL]))
		expect(git_command.checkout_b).not.toHaveBeenCalled()
	})

	it('refuses by name when auto-merge is on but its checks failed, so it will never fire', async () => {
		vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([LANDING_PULL])
		vi.mocked(git_pr_checks.read_merge_progress).mockResolvedValue('failed')

		const message = await flush_message()

		expect(message).toBe(observations_flush_landing.stuck_flush_message([LANDING_PULL]))
		expect(git_pr_checks.read_merge_progress).toHaveBeenCalledWith(LANDING_PULL.head_ref)
		expect(git_command.checkout_b).not.toHaveBeenCalled()
	})

	it('looks only at flush branches', async () => {
		await flush_message()

		expect(git_gh_command.pr_list_open_with_head_prefix).toHaveBeenCalledWith('observations/')
	})
})
