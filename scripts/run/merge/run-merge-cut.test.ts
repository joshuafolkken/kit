import { git_gh_command } from '#scripts/gh/git-gh-command'
import type { IssueReference } from '#scripts/issue/issue-reference'
import { issue_state_cli } from '#scripts/issue/issue-state-cli'
import { lane_seat_stop } from '#scripts/lane/lane-seat-stop'
import { lane_vacant } from '#scripts/lane/lane-vacant'
import { run_carry } from '#scripts/run/carry/run-carry'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_cut_cli } from '#scripts/run/cut/run-cut-cli'
import { run_cut_cli_fixture } from '#scripts/run/cut/run-cut-cli-fixture'
import { run_cut_report } from '#scripts/run/cut/run-cut-report'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: {
		issue_add_label: vi.fn(async () => true),
		issue_try_comment: vi.fn(),
	},
}))
vi.mock('#scripts/run/run-label', () => ({ run_label: { unmark: vi.fn() } }))
vi.mock('./run-merge-ship', () => ({ run_merge_ship: { cause: vi.fn() } }))

const { run_merge_steps } = await import('./run-merge-steps')
const { ISSUE, existing_cut, target, verdict } = run_cut_cli_fixture
const CONTEXT = {
	child: ISSUE,
	epic: undefined,
	repo: undefined,
	over: undefined,
	owner: run_carry.NO_OWNER,
}
const BLOCKER: IssueReference = { number: 6310, repo: 'joshuafolkken/kit', state: 'OPEN' }
const STOP_FAILURE = 'worker still alive'

run_cut_cli_fixture.install()

// Only lane lookup is substituted: adoption, release and CLI resume share the scratch record.
function carried(): ReturnType<typeof run_cut.lane_cut_sync> {
	const read = run_cut.read_cut(target())

	return read.kind === 'carried' ? { target: target(), cut: read.cut } : undefined
}

beforeEach(() => {
	vi.spyOn(run_carry, 'repository_directory').mockResolvedValue(undefined)
	vi.spyOn(lane_seat_stop, 'stop').mockResolvedValue()
	vi.spyOn(lane_vacant, 'is_vacant').mockResolvedValue(false)
	vi.spyOn(run_cut, 'lane_cut_sync').mockImplementation(carried)
	vi.spyOn(git_gh_command, 'issue_blocked_by_references').mockResolvedValue([BLOCKER])
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(undefined)
	vi.spyOn(issue_state_cli, 'read_issue').mockResolvedValue({ kind: 'missing' })
})

async function adopt(): Promise<void> {
	existing_cut()
	await run_cut_cli.run(['--resume', ISSUE])
	expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
}

describe('a released lane resumes its adopted cut', () => {
	it('resumes after release to wait on a blocker', async () => {
		await adopt()

		const result = await run_merge_steps.do_failed(CONTEXT)

		await run_cut_cli.run(['--resume', ISSUE])

		expect(result.waits).toHaveLength(1)
		expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
	})

	it('keeps a second resume handed-off until the adopter is stopped', async () => {
		await adopt()

		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_report.HANDED_OFF_VERDICT)
		expect(lane_seat_stop.stop).not.toHaveBeenCalled()
	})

	it('preserves the adoption when stopping the worker fails', async () => {
		await adopt()
		vi.mocked(lane_seat_stop.stop).mockRejectedValue(new Error(STOP_FAILURE))

		await expect(run_merge_steps.do_failed(CONTEXT)).rejects.toThrow(STOP_FAILURE)
		await run_cut_cli.run(['--resume', ISSUE])

		expect(verdict()).toBe(run_cut_report.HANDED_OFF_VERDICT)
	})

	it('resumes after a mechanical park too', async () => {
		await adopt()
		vi.mocked(git_gh_command.issue_blocked_by_references).mockResolvedValue([])

		const result = await run_merge_steps.do_failed(CONTEXT)

		await run_cut_cli.run(['--resume', ISSUE])

		expect(result.is_parked).toBe(true)
		expect(verdict()).toBe(run_cut_cli.RESUME_VERDICT)
	})
})
