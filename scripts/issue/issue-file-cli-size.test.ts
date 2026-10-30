import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#4675: `josh issue:file` refuses a size estimate over the split guide before any
// create, unless the filing is a split or declares why it stays one Issue. The guide itself is
// `size-estimate.test.ts`'s; here only the filing's wiring of the route is asserted.

const HERE = 'joshuafolkken/kit'
const FAILURE_EXIT_CODE = 1
const OVER_GUIDE = '- 規模見積もり: 約 30 ファイル / 900 行（テスト除く）'
const REASON = '- 分割しない理由: 1 コミットで入れないと壊れる'

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-size-'))
const over_path = path.join(work, 'over.md')
const reasoned_path = path.join(work, 'reasoned.md')

function body_of(...declarations: ReadonlyArray<string>): string {
	const sections = '## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n'

	return [
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 人の判断: 要（目視確認）',
		...declarations,
		'',
		sections,
	].join('\n')
}

writeFileSync(over_path, body_of(OVER_GUIDE))
writeFileSync(reasoned_path, body_of(OVER_GUIDE, REASON))

function argv_of(body_file: string, ...extra: ReadonlyArray<string>): Array<string> {
	return ['A title', '--body-file', body_file, ...extra]
}

// The scout answers nothing, so a filing the guide lets through stops there, before any create.
const scout = vi.spyOn(issue_scout_cli, 'scout')

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: undefined, is_capped: false })
	scout.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(work, { recursive: true, force: true })
})

function refusals(): string {
	return vi.mocked(console.error).mock.calls.join('\n')
}

describe('issue_file_cli.run — a size estimate over the split guide', () => {
	it('refuses the filing, naming the guide and the question', async () => {
		expect(await issue_file_cli.run(argv_of(over_path))).toBe(FAILURE_EXIT_CODE)
		expect(refusals()).toContain('exceeds the guide (more than 8 files or 200 lines)')
		expect(refusals()).toContain('split-assessment.md → "The question"')
	})

	it.each([
		['filed as a split', argv_of(over_path, '--route', 'split')],
		['with a reason declared', argv_of(reasoned_path)],
	])('lets it through %s', async (_label, argv) => {
		await issue_file_cli.run(argv)

		expect(refusals()).not.toContain('exceeds the guide')
		expect(scout).toHaveBeenCalledTimes(1)
	})
})
