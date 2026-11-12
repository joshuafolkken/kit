import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_pr_checks } from '#scripts/gh/git-pr-checks'
import { git_command } from '#scripts/git/git-command'
import { main_sync } from '#scripts/git/main-sync'
import { review_comment_carry } from '#scripts/review/review-comment-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { observation_ledger_archive } from './observation-ledger-archive'
import { observation_ledger_prepare } from './observation-ledger-prepare'
import { observations_flush } from './observations-flush'
import { FLUSH_BRANCH, MODIFIED_LEDGER, MORNING_INSTANT } from './observations-flush-fixture'
import { observations_flush_transaction } from './observations-flush-transaction'

const SYNC_COMMAND = 'pnpm josh ms'

vi.mock('#scripts/git/git-command', () => ({
	git_command: {
		branch: vi.fn(),
		get_default_branch: vi.fn(),
		status: vi.fn(),
		fetch_branch: vi.fn(),
		commit_count_beyond: vi.fn(),
		merge_fast_forward: vi.fn(),
		head_commit: vi.fn(),
		push: vi.fn(),
	},
}))
vi.mock('#scripts/gh/git-gh-command', () => ({
	git_gh_command: {
		pr_create: vi.fn(),
		pr_enable_auto_merge: vi.fn(),
		pr_list_open_with_head_prefix: vi.fn(),
	},
}))
vi.mock('#scripts/gh/git-pr-checks', () => ({
	git_pr_checks: {
		read_merge_progress: vi.fn(),
		wait_for_pr_merged: vi.fn(),
	},
}))
vi.mock('#scripts/git/main-sync', () => ({ main_sync: { run: vi.fn() } }))
vi.mock('#scripts/review/review-comment-carry', () => ({
	review_comment_carry: {
		carry_reported: vi.fn(),
		discard_uncommitted: vi.fn(),
	},
}))
vi.mock('./observation-ledger-archive', () => ({
	observation_ledger_archive: { archive: vi.fn() },
}))
vi.mock('./observation-ledger-prepare', () => ({
	observation_ledger_prepare: { prepare: vi.fn() },
}))
vi.mock('./observations-flush-transaction', () => ({
	observations_flush_transaction: {
		pending: vi.fn(),
		run: vi.fn(),
	},
}))

async function flush(): Promise<string> {
	return await observations_flush.flush(new Date(MORNING_INSTANT))
}

function on_default_branch(): void {
	vi.mocked(git_command.branch).mockResolvedValue('main')
	vi.mocked(git_command.get_default_branch).mockResolvedValue('main')
	vi.mocked(git_command.status).mockResolvedValue(MODIFIED_LEDGER)
	vi.mocked(git_command.commit_count_beyond).mockResolvedValue(0)
	vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([])
	vi.mocked(git_pr_checks.read_merge_progress).mockResolvedValue('waiting')
	vi.mocked(git_pr_checks.wait_for_pr_merged).mockResolvedValue('merged')
	vi.mocked(main_sync.run).mockResolvedValue(0)
}

beforeEach(() => {
	vi.resetAllMocks()
	on_default_branch()
	vi.mocked(observation_ledger_prepare.prepare).mockResolvedValue([])
	vi.mocked(observation_ledger_archive.archive).mockResolvedValue(1)
	vi.mocked(observations_flush_transaction.pending).mockResolvedValue(false)
	vi.mocked(observations_flush_transaction.run).mockImplementation(async (_root, branch, steps) => {
		await steps.publish(branch, await steps.prepare())

		return branch
	})
})

it('prepares and lands inside the transaction, then syncs the original default checkout', async () => {
	await expect(flush()).resolves.toContain(FLUSH_BRANCH)
	expect(observations_flush_transaction.run).toHaveBeenCalledWith(
		process.cwd(),
		FLUSH_BRANCH,
		expect.any(Object),
	)
	expect(review_comment_carry.discard_uncommitted).not.toHaveBeenCalled()
	expect(observation_ledger_prepare.prepare).toHaveBeenCalledOnce()
	expect(git_gh_command.pr_create).toHaveBeenCalledWith(
		observations_flush.COMMIT_MESSAGE,
		observations_flush.pull_request_body(1),
		'ignore-for-release',
	)
	expect(main_sync.run).toHaveBeenCalledWith([])
})

it('never syncs or publishes when preparation fails', async () => {
	vi.mocked(observation_ledger_prepare.prepare).mockResolvedValue([
		{ line: 'broken', reason: 'invalid' },
	])
	await expect(flush()).rejects.toThrow('invalid')
	expect(git_command.push).not.toHaveBeenCalled()
	expect(main_sync.run).not.toHaveBeenCalled()
})

it.each(['push', 'pr_create'] as const)(
	'preserves the source and directs recovery after %s fails',
	async (step) => {
		const command = step === 'push' ? git_command.push : git_gh_command.pr_create

		vi.mocked(command).mockRejectedValue(new Error('publication rejected'))
		await expect(flush()).rejects.toThrow(
			`The ledger is committed on \`${FLUSH_BRANCH}\` in the recovery worktree; publication failed: publication rejected. The source checkout and original records are preserved. Rerun \`pnpm josh observations:flush\` from the source checkout to resume.`,
		)
		expect(main_sync.run).not.toHaveBeenCalled()
	},
)

it('refuses unrelated staged, unstaged and untracked work without invoking the transaction', async () => {
	for (const status of ['M  source.ts', ' M source.ts', '?? notes.txt']) {
		vi.mocked(git_command.status).mockResolvedValue(status)
		// eslint-disable-next-line no-await-in-loop -- each command has its own preflight state
		await expect(flush()).rejects.toThrow('changes besides the ledger')
	}

	expect(observations_flush_transaction.run).not.toHaveBeenCalled()
})

it('refuses a staged ledger and preserves its index', async () => {
	vi.mocked(git_command.status).mockResolvedValue('M  .josh/observations/1.md')
	await expect(flush()).rejects.toThrow('index left untouched')
	expect(observations_flush_transaction.run).not.toHaveBeenCalled()
})

it('does not let a stale-source fast-forward block recovery of an already merged payload', async () => {
	vi.mocked(observations_flush_transaction.pending).mockResolvedValue(true)
	vi.mocked(git_pr_checks.read_merge_progress).mockResolvedValue('merged')
	await flush()
	expect(git_command.fetch_branch).not.toHaveBeenCalled()
	expect(git_gh_command.pr_create).not.toHaveBeenCalled()
	expect(main_sync.run).toHaveBeenCalled()
})

it('does not open a second pull request for an existing flush branch', async () => {
	vi.mocked(observations_flush_transaction.pending).mockResolvedValue(true)
	vi.mocked(git_gh_command.pr_list_open_with_head_prefix).mockResolvedValue([
		{ number: 1, head_ref: FLUSH_BRANCH, has_auto_merge: true },
	])
	await flush()
	expect(git_gh_command.pr_create).not.toHaveBeenCalled()
	expect(git_pr_checks.wait_for_pr_merged).toHaveBeenCalledWith(FLUSH_BRANCH)
})

it('retains the old off-default refusal before any transaction starts', async () => {
	vi.mocked(git_command.branch).mockResolvedValue('feature')
	await expect(flush()).rejects.toThrow(SYNC_COMMAND)
	expect(observations_flush_transaction.run).not.toHaveBeenCalled()
})

function first_call_order(command: (...args: Array<never>) => unknown): number {
	return vi.mocked(command).mock.invocationCallOrder[0] ?? NaN
}

describe('observations_flush — the comment-round carry', () => {
	it('carries the comment rounds and commits their file on a tree that was clean before', async () => {
		vi.mocked(git_command.status).mockResolvedValue('')
		await flush()
		expect(review_comment_carry.carry_reported).toHaveBeenCalledWith(process.cwd())
		expect(git_gh_command.pr_create).toHaveBeenCalledOnce()
	})

	it('carries only after the default branch is fast-forwarded', async () => {
		vi.mocked(git_command.commit_count_beyond).mockResolvedValue(1)
		await flush()
		expect(first_call_order(git_command.merge_fast_forward)).toBeLessThan(
			first_call_order(review_comment_carry.carry_reported),
		)
	})
})

describe('observations_flush — a default branch behind origin', () => {
	const LEDGER_CONFLICT = 'Your local changes would be overwritten by merge'

	beforeEach(() => {
		vi.mocked(git_command.commit_count_beyond).mockResolvedValue(1)
	})

	it('fast-forwards the default branch before cutting the flush branch', async () => {
		await flush()
		expect(git_command.merge_fast_forward).toHaveBeenCalledWith('main')
		expect(first_call_order(git_command.merge_fast_forward)).toBeLessThan(
			first_call_order(observations_flush_transaction.run),
		)
	})

	it('refuses before cutting a branch and names pnpm josh ms when the fast-forward fails', async () => {
		vi.mocked(git_command.merge_fast_forward).mockRejectedValue(new Error(LEDGER_CONFLICT))
		await expect(flush()).rejects.toThrow(SYNC_COMMAND)
		await expect(flush()).rejects.toThrow(LEDGER_CONFLICT)
		expect(observations_flush_transaction.run).not.toHaveBeenCalled()
	})

	it('does not touch the working tree when the fast-forward is refused', async () => {
		vi.mocked(git_command.merge_fast_forward).mockRejectedValue(new Error(LEDGER_CONFLICT))
		await expect(flush()).rejects.toThrow(LEDGER_CONFLICT)
		expect(observations_flush_transaction.run).not.toHaveBeenCalled()
		expect(review_comment_carry.carry_reported).not.toHaveBeenCalled()
		expect(git_command.push).not.toHaveBeenCalled()
	})
})

describe('observations_flush — a flush branch that is still in the checkout', () => {
	beforeEach(() => {
		vi.mocked(git_command.branch).mockResolvedValue(FLUSH_BRANCH)
	})

	it('tells a zero-commit branch to return to the default branch and flush again', async () => {
		await expect(flush()).rejects.toThrow('nothing is stranded')
		await expect(flush()).rejects.toThrow(SYNC_COMMAND)
		expect(observations_flush_transaction.run).not.toHaveBeenCalled()
	})

	it('warns about the only copy when the commit count cannot be read', async () => {
		vi.mocked(git_command.commit_count_beyond).mockRejectedValue(new Error('unknown revision'))
		await expect(flush()).rejects.toThrow('only copy')
		expect(observations_flush_transaction.run).not.toHaveBeenCalled()
	})
})

it('reports source synchronization failure after landing without publishing again', async () => {
	vi.mocked(main_sync.run).mockResolvedValue(1)
	await expect(flush()).rejects.toThrow('Could not return this checkout')
	expect(git_pr_checks.wait_for_pr_merged).toHaveBeenCalledWith(FLUSH_BRANCH)
	expect(observations_flush_transaction.run).toHaveBeenCalledOnce()
})

it('prepares before publishing and synchronizes only after landing', async () => {
	await flush()
	const orders = [
		observation_ledger_prepare.prepare,
		git_command.push,
		git_gh_command.pr_create,
		git_gh_command.pr_enable_auto_merge,
		git_pr_checks.wait_for_pr_merged,
		main_sync.run,
	].map((command) => first_call_order(command))

	expect(orders.every((order) => Number.isSafeInteger(order))).toBe(true)
	expect(orders).toEqual(orders.toSorted((left, right) => left - right))
})
