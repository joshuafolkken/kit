import { auto_ok_fixture, CREATED_EARLIER } from '#scripts/auto-ok/auto-ok-fixture'
import { backlog_pool } from '#scripts/backlog/backlog-pool'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import { issue_observation_fixture as fixture } from '#scripts/issue/issue-observation-fixture'
import { issue_observation_gate } from '#scripts/issue/issue-observation-gate'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { josh_command } from '#scripts/josh/josh-run'
import { lane_registry } from '#scripts/lane/lane-registry'
import { lane_seat_fixture } from '#scripts/lane/lane-seat-fixture'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_merge_cut_release } from '#scripts/run/merge/run-merge-cut-release'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { run_merge_steps } from './run-merge-steps'

const ISSUE = 7400
const CHILD = String(ISSUE)
const IN_PROGRESS = 'in-progress'
const CONTEXT = {
	child: CHILD,
	epic: undefined,
	repo: undefined,
	over: undefined,
	owner: run_carry.NO_OWNER,
}

function classify(): ReturnType<typeof backlog_pool.classify_standalone> {
	const row = { ...auto_ok_fixture.issue(ISSUE, CREATED_EARLIER), body: fixture.BODY }

	return backlog_pool.classify_standalone([row], {
		tracked: new Map(),
		exclude: [],
		repo: 'joshuafolkken/kit',
		running: new Set(),
	})
}

function stub_release(): void {
	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockResolvedValue(
		'{"labels":[{"name":"in-progress"}]}',
	)
	vi.spyOn(git_gh_command, 'issue_remove_label').mockResolvedValue()
	vi.spyOn(git_gh_issue_write, 'issue_try_comment').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(run_merge_cut_release, 'release').mockResolvedValue()
	vi.spyOn(lane_registry, 'find_open_lane').mockResolvedValue({
		issue: CHILD,
		directory: '/test/observation-lane',
		branch: '7400-lane',
		is_stranded: false,
		seat: undefined,
		development_port: undefined,
		preview_port: undefined,
		output: undefined,
	})
	vi.spyOn(lane_vacant, 'is_vacant').mockResolvedValue(true)
	vi.spyOn(josh_command, 'josh_run').mockResolvedValue({ code: 0, out: '' })
}

beforeEach(() => {
	lane_seat_fixture.mock_stop()
	stub_release()
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([])
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(fixture.BODY)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({
		kind: 'state',
		state: { state: 'OPEN', labels: [IN_PROGRESS], is_human_review: false },
	})
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(
		JSON.stringify({
			body: fixture.comment(),
			html_url: fixture.URL,
			author_association: 'OWNER',
			user: { login: 'owner' },
		}),
	)
})

afterEach(() => {
	vi.restoreAllMocks()
	issue_observation_gate.reset()
})

function expect_released(): void {
	expect(git_gh_issue_write.issue_add_label).not.toHaveBeenCalled()
	expect(git_gh_command.issue_remove_label).toHaveBeenCalledWith(CHILD, IN_PROGRESS)
	expect(run_merge_cut_release.release).toHaveBeenCalledWith(CHILD)
	expect(josh_command.josh_run).toHaveBeenCalledWith(['lane:close', CHILD])
}

function expect_resume(): void {
	expect(classify().runnable).toEqual([])
	issue_observation_gate.reset()
	expect(classify().runnable).toEqual([])
	issue_observation_gate.record(fixture.URL, fixture.comment(fixture.KEYS))
	expect(classify().runnable.map((row) => row.number)).toEqual([ISSUE])
}

it('releases an unfinished investigation, withholds it across restart and offers it only after evidence', async () => {
	const count = vi.spyOn(run_carry, 'apply_change')
	const result = await run_merge_steps.do_failed(CONTEXT)

	expect(result).toMatchObject({ is_parked: false, is_refused: false })
	expect(result.waits.join(',')).toContain('multi-slot, same-head, comparison, cost')
	expect(count).not.toHaveBeenCalled()
	expect_released()
	expect_resume()
})

it.each(['readable', 'unknown'])(
	'keeps an unreadable investigation body retryable with %s labels',
	async (state) => {
		vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(undefined)

		if (state === 'unknown') {
			vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({ kind: 'unreadable' })
		}

		const count = vi.spyOn(run_carry, 'apply_change')
		const result = await run_merge_steps.do_failed(CONTEXT)

		expect(result).toMatchObject({
			is_parked: false,
			is_refused: false,
			waits: ['issue body confirmation'],
		})
		expect(count).not.toHaveBeenCalled()
		expect_released()
	},
)
