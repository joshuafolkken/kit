import {
	DISTRIBUTED_ROOT_FILE,
	DISTRIBUTED_SKILL_FILE,
	DISTRIBUTED_SYNC_ARTIFACT,
} from '#scripts/managed-config-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_command } from './git-command'
import { git_gh_command } from './git-gh-command'
import { git_pr_managed_config, MANAGED_CONFIG_BYPASS_NOTE } from './git-pr-managed-config'
import { telegram_notify } from './telegram-notify'

// `./git-command` rather than `./changed-paths`: the gate reads the **tracked** branch diff and lets
// the shared helper split the lines, so mocking the helper would stub the very splitting under test.
vi.mock('./git-command', () => ({
	git_command: { diff_main_names: vi.fn() },
}))
vi.mock('./git-gh-command', () => ({
	git_gh_command: { pr_comment: vi.fn() },
}))
vi.mock('./telegram-notify', () => ({
	telegram_notify: { send_or_report: vi.fn() },
}))

// The distribution lists themselves are **not** mocked: the defect joshuafolkken/kit#1578 records is
// a real path failing to be matched, so the gate is exercised against the lists it will run
// against in production. Only the diff read, the pull request and Telegram are stubbed.
const UNDISTRIBUTED_FILE = 'scripts/git/git-pr-managed-config.ts'

const BRANCH_NAME = 'feature-branch'
const REASON = 'The distributed change is the point of this pull request; reviewed with the user.'

const CONTEXT = {
	repo_name: 'kit',
	issue_title: 'Some issue',
	issue_url: 'https://github.com/joshuafolkken/kit/issues/1578',
	pr_url: 'https://github.com/joshuafolkken/kit/pull/1579',
}

const mocked_diff_main_names = vi.mocked(git_command.diff_main_names)
const mocked_pr_comment = vi.mocked(git_gh_command.pr_comment)
const mocked_send = vi.mocked(telegram_notify.send_or_report)

const DIFF_LINE_SEPARATOR = '\n'

function given_changed(paths: ReadonlyArray<string>): void {
	mocked_diff_main_names.mockResolvedValue(paths.join(DIFF_LINE_SEPARATOR))
}

async function run_gate(ignore_reason?: string): Promise<Array<string>> {
	return await git_pr_managed_config.handle_managed_config_changes({
		branch_name: BRANCH_NAME,
		ignore_reason,
		context: CONTEXT,
		should_merge: true,
	})
}

beforeEach(() => {
	vi.clearAllMocks()
})

describe('handle_managed_config_changes — a diff that distributes nothing', () => {
	it('returns no audit note', async () => {
		given_changed([UNDISTRIBUTED_FILE])

		await expect(run_gate()).resolves.toEqual([])
	})

	it('neither comments on the pull request nor notifies', async () => {
		given_changed([UNDISTRIBUTED_FILE])
		await run_gate()

		expect(mocked_pr_comment).not.toHaveBeenCalled()
		expect(mocked_send).not.toHaveBeenCalled()
	})

	it('returns no audit note for an empty diff', async () => {
		given_changed([])

		await expect(run_gate()).resolves.toEqual([])
	})
})

describe('handle_managed_config_changes — a distributed file with no reason', () => {
	it('stops the run', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_gate()).rejects.toThrow(DISTRIBUTED_ROOT_FILE)
	})

	// The whole of joshuafolkken/kit#1578: this path matches no list entry textually, so an eye
	// comparison against the arrays misses it and the run merges a distributed change unreviewed.
	it('stops on a file under a distributed directory it does not textually equal', async () => {
		given_changed([UNDISTRIBUTED_FILE, DISTRIBUTED_SKILL_FILE])

		await expect(run_gate()).rejects.toThrow(DISTRIBUTED_SKILL_FILE)
	})

	it('names the list that claimed the path', async () => {
		given_changed([DISTRIBUTED_SKILL_FILE])

		await expect(run_gate()).rejects.toThrow('AI_COPY_DIRECTORIES')
	})

	it('sends a confirmation notification before stopping', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])
		await expect(run_gate()).rejects.toThrow()

		expect(mocked_send).toHaveBeenCalledTimes(1)
		expect(mocked_send.mock.calls[0]?.[0]?.task_type).toBe('confirmation')
	})

	it('leaves no bypass comment on the pull request', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])
		await expect(run_gate()).rejects.toThrow()

		expect(mocked_pr_comment).not.toHaveBeenCalled()
	})

	// A bypass has to say something a person can audit later; an empty string says nothing.
	it('treats a whitespace-only reason as no reason at all', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_gate(' '.repeat(3))).rejects.toThrow(DISTRIBUTED_ROOT_FILE)
	})
})

describe('handle_managed_config_changes — a distributed file with an explicit reason', () => {
	it('proceeds and returns the audit note', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_gate(REASON)).resolves.toEqual([MANAGED_CONFIG_BYPASS_NOTE])
	})

	it('records the reason and the affected paths on the pull request', async () => {
		given_changed([DISTRIBUTED_SKILL_FILE])
		await run_gate(REASON)

		expect(mocked_pr_comment).toHaveBeenCalledTimes(1)
		expect(mocked_pr_comment.mock.calls[0]?.[0]).toBe(BRANCH_NAME)
		expect(mocked_pr_comment.mock.calls[0]?.[1]).toContain(REASON)
		expect(mocked_pr_comment.mock.calls[0]?.[1]).toContain(DISTRIBUTED_SKILL_FILE)
	})

	it('sends no confirmation notification', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])
		await run_gate(REASON)

		expect(mocked_send).not.toHaveBeenCalled()
	})
})

// The gate reading only the three `AI_COPY_*` lists was narrower than the prose it replaced, whose
// own worked example is this file (joshuafolkken/kit#1578).
describe('handle_managed_config_changes — a file josh sync writes outside the AI_COPY lists', () => {
	it('stops the run on a path no AI_COPY list holds', async () => {
		given_changed([DISTRIBUTED_SYNC_ARTIFACT])

		await expect(run_gate()).rejects.toThrow(DISTRIBUTED_SYNC_ARTIFACT)
	})

	it('names the source that claimed it', async () => {
		given_changed([DISTRIBUTED_SYNC_ARTIFACT])

		await expect(run_gate()).rejects.toThrow('SYNCED_PATHS')
	})
})

// `--no-merge` ends with the pull request open for a person to look at, which is what this gate asks
// for. Stopping there would withhold the completion notification and the wrap-up from a run that was
// never going to distribute anything.
async function run_without_merge(): Promise<Array<string>> {
	return await git_pr_managed_config.handle_managed_config_changes({
		branch_name: BRANCH_NAME,
		ignore_reason: undefined,
		context: CONTEXT,
		should_merge: false,
	})
}

describe('handle_managed_config_changes — a run that is not merging', () => {
	it('does not stop even on a distributed change', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])

		await expect(run_without_merge()).resolves.toEqual([])
	})

	it('reads no diff at all', async () => {
		given_changed([DISTRIBUTED_ROOT_FILE])
		await run_without_merge()

		expect(mocked_diff_main_names).not.toHaveBeenCalled()
		expect(mocked_send).not.toHaveBeenCalled()
	})
})
