import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'
import { issue_file_cli } from './issue-file-cli'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#4460: `josh issue:file` refuses a start condition citing an issue rather than a
// pull request before any listing or create, and names the pull request that closed the issue.
// What passes is `issue-sample-source.test.ts`'s; here only the filing's refusal is asserted.

const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const CITED = 4442
const CLOSING = 4448
const FAILURE_EXIT_CODE = 1

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-source-'))
const body_path = path.join(work, 'conditioned.md')

const origin_path = path.join(work, 'origin.md')
const BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	'- 人の判断: 不要',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	`- 実施可能条件: #${String(CITED)} のマージ後 30 マージ`,
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')

writeFileSync(body_path, BODY)
writeFileSync(origin_path, `${BODY}\n## Origin\n\n${HERE}#2808\n`)

function argv_of(body_file: string, ...extra: ReadonlyArray<string>): Array<string> {
	return ['A title', '--body-file', body_file, ...extra]
}

const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const scout = vi.spyOn(issue_scout_cli, 'scout')

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(issue_closing_pr, 'read_closing_pr').mockResolvedValue(
		`https://github.com/${HERE}/pull/${String(CLOSING)}`,
	)
	exec_gh_api.mockResolvedValue(JSON.stringify({ number: CITED }))
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_cli.run — a start condition citing an issue', () => {
	it('refuses the filing, citing the pull request that closed the issue', async () => {
		expect(await issue_file_cli.run(argv_of(body_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(`#${String(CLOSING)}`)
		expect(exec_gh_api).toHaveBeenCalledTimes(1)
		expect(scout).not.toHaveBeenCalled()
	})

	it('reads the number in the target repository', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).toHaveBeenCalledWith({
			path: git_gh_api_path.issue_api_path(String(CITED), THERE),
		})
	})
})
