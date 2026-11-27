import { backlog_triage_close } from '#scripts/backlog/backlog-triage-close'
import { git_gh_issue_read } from '#scripts/gh/git-gh-issue-read'
import { git_diff_reads } from '#scripts/git/git-diff-reads'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { run_cut_cli } from './run-cut-cli'
import { run_cut_cli_fixture } from './run-cut-cli-fixture'
import { run_cut_report } from './run-cut-report'

// joshuafolkken/kit#7821: a lane that changed nothing closes its investigation Issue as completed with
// `--deliverable`, and is refused `unready` with the missing condition otherwise.

const { ISSUE, BRANCH, DEFAULT_BRANCH, state, verdict, printed_errors, launch, print_section } =
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

const CHANGED_A = 'scripts/a.ts\n'
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
		expect(print_section).not.toHaveBeenCalled()
	})

	it('refuses unready without closing when the lane changed a file (ac-5424e7c4)', async () => {
		changed.names = CHANGED_A

		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(close_completed).not.toHaveBeenCalled()
		expect(printed_errors()).toContain('the lane changed scripts/a.ts')
	})

	it('refuses a dirty lane tree naming its changed files, never taking a cut', async () => {
		state.mockResolvedValue({ branch: BRANCH, is_dirty: true, is_held: true })
		changed.names = 'scripts/dirty.ts\n'

		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(1)
		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(close_completed).not.toHaveBeenCalled()
		expect(launch).not.toHaveBeenCalled()
		expect(printed_errors()).toContain('the lane changed scripts/dirty.ts')
	})

	it('keeps the bare refusal without --deliverable, reading neither body nor diff', async () => {
		const code = await run_cut_cli.run([ISSUE])

		expect(code).toBe(1)
		expect(close_completed).not.toHaveBeenCalled()
		expect(git_gh_issue_read.issue_get_body).not.toHaveBeenCalled()
		expect(printed_errors()).not.toContain('no-diff')
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

	it('points an unmet close at a rerun of itself, never the gate (ac-452c2664)', async () => {
		changed.names = CHANGED_A

		await run_cut_cli.run(WITH_DELIVERABLE)

		expect(verdict()).toBe(run_cut_cli.UNREADY_VERDICT)
		expect(printed_errors()).toContain(
			`next: meet the condition printed above, then rerun \`pnpm josh run:cut ${ISSUE} --deliverable ${DELIVERABLE}\`.`,
		)
		expect(printed_errors()).not.toContain('run:chain')
	})

	it('reports a failed close as a fault', async () => {
		close_completed.mockResolvedValue({ problem: 'closing failed; re-run this command' })

		const code = await run_cut_cli.run(WITH_DELIVERABLE)

		expect(code).toBe(1)
		expect(printed_errors()).toContain('re-run this command')
	})
})
