import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'

// joshuafolkken/kit#5985: the filing asks the split direction among its holds, so an independent split
// the kept Issue's criteria depend on is refused before anything is created. The direction's answers
// are `split-direction.test.ts`'s; here only the filing's wiring is asserted.

const HERE = 'joshuafolkken/kit'
const FAILURE_EXIT_CODE = 1
const KEPT = '5953'
const RELAY = 'scripts/run/entry/run-entry-cli.ts'

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-split-'))
const body_path = path.join(work, 'body.md')

writeFileSync(
	body_path,
	[
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 人の判断: 要（目視確認）',
		'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
		`- 対象: \`${RELAY}\``,
		'',
		'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
	].join('\n'),
)

const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
	vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
	vi.spyOn(git_gh_command, 'issue_get_body').mockResolvedValue(
		'## 受け入れ条件\n\n- [ ] `run-entry-cli.ts` が中継する\n',
	)
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_cli.run — the split direction', () => {
	it('refuses a split child whose kept Issue names its module, before any create', async () => {
		const argv = ['A title', '--body-file', body_path, '--route', 'split', '--found-during', KEPT]

		expect(await issue_file_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			`run:split ${KEPT} --prerequisite`,
		)
	})
})
