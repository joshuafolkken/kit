import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli, type BundleMode } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { split_resolution } from '#scripts/split/split-resolution'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_file_interrupt } from './issue-file-interrupt'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#8172: an unpublished split child reaches publishing only through an epic, so its
// `epic:bundle` placement is applied and a placement that places nothing fails the filing; any other
// filing keeps the report-only placement, whose failure is a warning. The placement's own answers are
// `epic-bundle-apply.test.ts`'s; here only the filing's wiring is asserted.

const HERE = 'joshuafolkken/kit'
const ISSUE_NUMBER = 2900
const ISSUE_URL = `https://github.com/${HERE}/issues/${String(ISSUE_NUMBER)}`
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const BODY = [
	'## 概要\n\n要約\n',
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	'- 人の判断: 要（目視確認）',
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')

const body_path = path.join(temporary_directory('suite')('issue-file-cli-place-'), 'body.md')

writeFileSync(body_path, BODY)

const report_for = vi.spyOn(epic_bundle_cli, 'report_for')

// The filing steps around the placement, each cleared; the split-child ledger is
// `split-resolution.test.ts`'s and writes nothing here.
function clear_the_steps(): void {
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({ report: 'none', candidates: [] })
	vi.spyOn(git_gh_exec, 'exec_gh_api').mockResolvedValue(ISSUE_URL)
	vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
	vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
	vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
	vi.spyOn(issue_file_interrupt, 'block_finder').mockResolvedValue()
	vi.spyOn(split_resolution, 'record_child').mockResolvedValue()
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	clear_the_steps()
})

afterAll(() => {
	vi.restoreAllMocks()
})

interface Case {
	route: string
	mode: BundleMode
	placed: number
	exit_code: number
}

const SPLIT = 'split'
const INTERRUPT = 'interrupt'

function argv_of(route: string): Array<string> {
	return ['A title', '--body-file', body_path, '--route', route]
}

describe('issue_file_cli.run — the epic placement a filing applies', () => {
	it.each<Case>([
		{ route: SPLIT, mode: 'place', placed: SUCCESS_EXIT_CODE, exit_code: SUCCESS_EXIT_CODE },
		{ route: SPLIT, mode: 'place', placed: FAILURE_EXIT_CODE, exit_code: FAILURE_EXIT_CODE },
		{ route: INTERRUPT, mode: 'report', placed: SUCCESS_EXIT_CODE, exit_code: SUCCESS_EXIT_CODE },
		{ route: INTERRUPT, mode: 'report', placed: FAILURE_EXIT_CODE, exit_code: SUCCESS_EXIT_CODE },
	])(
		'--route $route runs epic:bundle $mode (answer $placed → exit $exit_code), URL printed',
		async ({ route, mode, placed, exit_code }) => {
			report_for.mockResolvedValue(placed)
			expect(await issue_file_cli.run(argv_of(route))).toBe(exit_code)
			expect(report_for).toHaveBeenCalledWith(ISSUE_NUMBER, HERE, mode)
			expect(vi.mocked(console.info).mock.calls.join('\n')).toContain(ISSUE_URL)
		},
	)

	// `issue:spill` and `--batch` file through `file_issue` and place their split children themselves,
	// so the filing only reports and still answers with the URL of an Issue that exists.
	it('leaves a split child filed through file_issue to its caller to place', async () => {
		report_for.mockResolvedValue(FAILURE_EXIT_CODE)
		const argv = argv_of(SPLIT)

		expect(await issue_file_cli.file_issue(argv)).toBe(ISSUE_URL)
		expect(report_for).toHaveBeenCalledWith(ISSUE_NUMBER, HERE, 'report')
	})
})
