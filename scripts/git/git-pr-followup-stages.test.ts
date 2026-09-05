import { beforeEach, describe, expect, it, vi } from 'vitest'
import { git_followup_stages } from './git-followup-stages'
import { git_pr_followup, type FollowupInput } from './git-pr-followup'

// joshuafolkken/kit#1349: nobody knew what `followup --merge` spent its 44 seconds on, because the
// command timed none of its own stages. What is pinned here is that every stage reaches the console,
// in the order it ran — including on the **failed** run, which is the invocation whose wait is
// longest and the one a block withheld would hide.
//
// A separate suite from `git-pr-followup.test.ts` for the reason `git-pr-followup-watch.test.ts` is
// one: that file is already at its length limit. **The mock scaffolding is per suite** by the same
// precedent — a `vi.mock` factory is registered for the file it is written in, and the two suites do
// not mock the same set (this one mocks the epic auto-close, which that one leaves real), so a shared
// setup would call `vi.mocked` on a module that is not mocked in the other.

vi.mock('./git-gh-command', () => ({
	git_gh_command: {
		repo_get_name_with_owner: vi.fn(),
		issue_get_title: vi.fn(),
		pr_get_url: vi.fn(),
		pr_get_body: vi.fn(),
		pr_get_review_comments: vi.fn(),
		pr_merge: vi.fn(),
		pr_comment: vi.fn(),
	},
}))

vi.mock('./git-pr-checks', () => ({
	git_pr_checks: { wait_for_pr_success: vi.fn() },
}))

// `has_ignore_reason` is part of the factory even though this suite never reaches it: it is a named
// export of this module that `git-pr-coderabbit.ts` imports, so the first case here that puts an
// unresolved CodeRabbit thread or an unreadable listing in front of the run would die on
// `No "has_ignore_reason" export is defined on the mock` — which reads as a product bug rather than a
// mock gap. `git-pr-followup.test.ts` supplies it for the same reason.
vi.mock('./git-pr-ai-review', () => ({
	git_pr_ai_review: { handle_ai_review_findings: vi.fn() },
	has_ignore_reason(reason: string | undefined): reason is string {
		return reason !== undefined && reason.trim().length > 0
	},
}))

vi.mock('./telegram-notify', () => ({
	telegram_notify: { send: vi.fn() },
}))

// Mocked rather than left real: the auto-close reads GitHub, and a timing suite that reached the
// network would measure the network.
vi.mock('./git-epic-close', () => ({
	git_epic_close: { close_completed_epics: vi.fn() },
}))

const { git_gh_command } = await import('./git-gh-command')
const { git_pr_checks } = await import('./git-pr-checks')
const { git_pr_ai_review } = await import('./git-pr-ai-review')
const { telegram_notify } = await import('./telegram-notify')
const { git_epic_close } = await import('./git-epic-close')

const { STAGE, STAGE_LINE_PREFIX, STAGE_TOTAL_PREFIX } = git_followup_stages

const BASE_INPUT: FollowupInput = {
	branch_name: 'test-branch',
	issue_number: '42',
	notify_config: undefined,
	coderabbit_ignore_reason: undefined,
	ai_review_ignore_reason: undefined,
	is_skip_watch: true,
	should_merge: false,
}

function answer_every_call(): void {
	vi.mocked(git_gh_command.repo_get_name_with_owner).mockResolvedValue('owner/repo')
	vi.mocked(git_gh_command.issue_get_title).mockResolvedValue('Test issue')
	vi.mocked(git_gh_command.pr_get_url).mockResolvedValue('https://github.com/owner/repo/pull/1')
	vi.mocked(git_gh_command.pr_get_body).mockResolvedValue('closes #42')
	vi.mocked(git_pr_checks.wait_for_pr_success).mockResolvedValue({
		rollup: [],
		merge_state_status: undefined,
		review_decision: undefined,
	})
	vi.mocked(git_gh_command.pr_get_review_comments).mockResolvedValue('[]')
	vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockResolvedValue([])
	vi.mocked(telegram_notify.send).mockResolvedValue()
	vi.mocked(git_gh_command.pr_merge).mockResolvedValue()
	vi.mocked(git_epic_close.close_completed_epics).mockResolvedValue()
}

function printed_lines(): Array<string> {
	return vi.mocked(console.info).mock.calls.map(([line]) => String(line))
}

// The stage names the block reported, in order — the durations are dropped, because what a stage took
// on a mocked call is not a fact about anything.
function printed_stages(): Array<string> {
	return printed_lines()
		.filter((line) => line.startsWith(STAGE_LINE_PREFIX))
		.map((line) => line.slice(STAGE_LINE_PREFIX.length).trimEnd().split(' ', 1)[0] ?? '')
}

const MERGED_RUN_STAGES: ReadonlyArray<string> = [
	STAGE.closes_check,
	STAGE.context,
	STAGE.checks_wait,
	STAGE.coderabbit_comments,
	STAGE.ai_review_comments,
	STAGE.telegram,
	STAGE.merge,
	STAGE.completion_comment,
	STAGE.epic_close,
]

beforeEach(() => {
	vi.clearAllMocks()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	answer_every_call()
})

describe('git_pr_followup.run — the stage block on a run that finished', () => {
	it('reports every stage of a merged run, in the order they ran', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(printed_stages()).toStrictEqual([...MERGED_RUN_STAGES])
	})

	it('closes the block with a total', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: true })

		expect(printed_lines().some((line) => line.startsWith(STAGE_TOTAL_PREFIX))).toBe(true)
	})

	it('reports no merge stage on a run that merged nothing', async () => {
		await git_pr_followup.run({ ...BASE_INPUT, should_merge: false })

		expect(printed_stages()).not.toContain(STAGE.merge)
	})
})

describe('git_pr_followup.run — the stage block on a run that failed', () => {
	const FAILURE = new Error('AI review blocker')

	beforeEach(() => {
		vi.mocked(git_pr_ai_review.handle_ai_review_findings).mockRejectedValue(FAILURE)
	})

	it('names the stage that threw and reports the ones before it', async () => {
		await expect(git_pr_followup.run({ ...BASE_INPUT, should_merge: true })).rejects.toThrow(
			FAILURE,
		)

		expect(printed_stages()).toStrictEqual([
			STAGE.closes_check,
			STAGE.context,
			STAGE.checks_wait,
			STAGE.coderabbit_comments,
			STAGE.interrupted,
		])
	})

	it('merges nothing, so the failure is not reported as a finished run', async () => {
		await expect(git_pr_followup.run({ ...BASE_INPUT, should_merge: true })).rejects.toThrow(
			FAILURE,
		)

		expect(vi.mocked(git_gh_command.pr_merge)).not.toHaveBeenCalled()
	})
})
