import { CONTEXT_CUT_THRESHOLD } from '#scripts/cost-runtime/context-cut-threshold'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_close } from '#scripts/lane/lane-close'
import { run_carry } from '#scripts/run/carry/run-carry'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#2769: the driver's park is explained on the issue, and a child GitHub merged but
// left OPEN is closed by `run:merge` through the same close `followup` uses.

const add_label_mock = vi.hoisted(() => vi.fn())
const comment_mock = vi.hoisted(() => vi.fn())
const ensure_closed_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: add_label_mock,
		issue_remove_label: vi.fn().mockResolvedValue(undefined),
		issue_try_comment: comment_mock,
	},
}))

vi.mock('#scripts/followup/git-followup-issue-close', () => ({
	git_followup_issue_close: { ensure_issue_closed: ensure_closed_mock, CLOSE_RECOVERY: 'recover' },
}))

vi.mock('#scripts/lane/lane-reap', () => ({ lane_reap: { reap_child: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')

const CHILD = '2761'
const PR_URL = 'https://github.com/joshuafolkken/kit/pull/2768'
const CONTEXT = {
	child: CHILD,
	epic: undefined,
	repo: undefined,
	over: CONTEXT_CUT_THRESHOLD,
	owner: run_carry.NO_OWNER,
}

beforeEach(() => {
	add_label_mock.mockReset().mockResolvedValue(true)
	comment_mock.mockReset().mockResolvedValue(undefined)
	ensure_closed_mock.mockReset().mockResolvedValue(undefined)
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
})

describe('run_merge_steps.do_failed — the park is explained on the issue', () => {
	it('comments the reason when it parks the child with needs-decision', async () => {
		await run_merge_steps.do_failed(CONTEXT, run_merge_steps.CUT_RELAUNCH_CAUSE)

		expect(comment_mock).toHaveBeenCalledOnce()
		expect(comment_mock).toHaveBeenCalledWith(
			CHILD,
			expect.stringContaining(`- Why: ${run_merge_steps.CUT_RELAUNCH_CAUSE}`),
		)
		expect(comment_mock).toHaveBeenCalledWith(CHILD, expect.stringContaining(`fullrun #${CHILD}`))
	})

	it('comments nothing when the needs-decision label could not be written', async () => {
		add_label_mock.mockResolvedValue(false)

		await run_merge_steps.do_failed(CONTEXT)

		expect(comment_mock).not.toHaveBeenCalled()
	})
})

describe('run_merge_steps.do_merged — a child merged while its issue stayed OPEN', () => {
	beforeEach(() => {
		vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
		vi.spyOn(lane_close, 'resolve_lane').mockResolvedValue({
			existing: undefined,
			targets: { directory: '/nonexistent-lane-2769', branch: `${CHILD}-lane` },
		})
	})

	it('closes the issue, naming the merged pull request and run:merge', async () => {
		await run_merge_steps.do_merged({ ...CONTEXT, merged_pr: PR_URL })

		expect(ensure_closed_mock).toHaveBeenCalledWith(
			{ issue_number: CHILD, pr_url: PR_URL, closer: 'pnpm josh run:merge' },
			expect.anything(),
		)
	})

	it('closes nothing for a child GitHub already closed', async () => {
		await run_merge_steps.do_merged(CONTEXT)

		expect(ensure_closed_mock).not.toHaveBeenCalled()
	})
})
