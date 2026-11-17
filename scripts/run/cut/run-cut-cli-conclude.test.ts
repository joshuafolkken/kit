import { backlog_triage_close } from '#scripts/backlog/backlog-triage-close'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_diff_reads } from '#scripts/git/git-diff-reads'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'
import { run_cut_report } from './run-cut-report'

// joshuafolkken/kit#7821: a lane that changed nothing closes its investigation Issue as completed with
// `--deliverable`, and is refused `unready` with the missing condition otherwise.

const { ISSUE, BRANCH, DEFAULT_BRANCH, state, verdict, printed_errors, launch } =
	run_cut_cli_fixture

run_cut_cli_fixture.install()

const DELIVERABLE = 'https://github.com/joshuafolkken/kit/issues/1839#issuecomment-1'
const BODY = [
	'## 背景',
	'',
	'- 規模見積もり: 約 0 ファイル / 0 行（テスト除く）',
	'',
	'## 受け入れ条件',
	'',
	'- [x] done',
].join('\n')

const WITH_DELIVERABLE = [ISSUE, '--deliverable', DELIVERABLE]

const close_completed = vi.fn<typeof backlog_triage_close.close_completed>()
const changed = { names: '' }

beforeEach(() => {
	changed.names = ''
	state.mockResolvedValue({ branch: BRANCH, is_dirty: false, is_held: true })
	vi.spyOn(git_gh_issue_read, 'issue_get_body').mockResolvedValue(BODY)
	vi.spyOn(git_diff_reads, 'diff_main_names').mockImplementation(async () => changed.names)
	vi.spyOn(git_diff_reads, 'untracked_names').mockResolvedValue('')
	vi.spyOn(backlog_triage_close, 'close_completed').mockImplementation(close_completed)
	close_completed.mockResolvedValue({ next: 'closed as completed · lane returned, not requeued' })
})

describe('run:cut --deliverable on a no-diff investigation lane', () => {
	it('closes the Issue as completed citing the deliverable (ac-1b7874a6)', async () => {
		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(0)
		expect(verdict()).toBe(run_cut_report.CONCLUDED_VERDICT)
		expect(close_completed).toHaveBeenCalledWith(ISSUE, DELIVERABLE)
		expect(launch).not.toHaveBeenCalled()
	})

	it('refuses unready without closing when the lane changed a file (ac-5424e7c4)', async () => {
		changed.names = 'scripts/a.ts\n'

		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(close_completed).not.toHaveBeenCalled()
		expect(printed_errors()).toContain('the lane changed 1 file(s)')
	})

	it('refuses unready without --deliverable and names the closing command', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(close_completed).not.toHaveBeenCalled()
		expect(printed_errors()).toContain(`run:cut ${ISSUE} --deliverable <comment-url>`)
	})
})

describe('run:cut --deliverable where the no-diff close does not apply', () => {
	it('keeps the bare refusal on the default branch', async () => {
		state.mockResolvedValue({ branch: DEFAULT_BRANCH, is_dirty: false, is_held: true })

		await run_cut_cli.run(WITH_DELIVERABLE)

		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(close_completed).not.toHaveBeenCalled()
		expect(printed_errors()).not.toContain('no-diff')
	})

	it('reports a failed close as a fault', async () => {
		close_completed.mockResolvedValue({ problem: 'closing failed; re-run this command' })

		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(1)
		expect(printed_errors()).toContain('re-run this command')
	})
})
