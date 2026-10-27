import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_api_path } from '#scripts/gh/git-gh-api-path'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_closing_pr } from './issue-closing-pr'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_sample_gate } from './issue-sample-gate'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#4460: `josh issue:file` refuses a start condition citing an issue rather than a
// pull request before any create, and names the pull request that closed the issue. What passes is
// `issue-sample-source.test.ts`'s; here only the filing's refusal is asserted. The run's holds clear
// and the scout answers nothing, so no filing reaches a create.

const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const CITED = 4442
const CLOSING = 4448
const FAILURE_EXIT_CODE = 1

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-source-'))
const body_path = path.join(work, 'conditioned.md')

const origin_path = path.join(work, 'origin.md')
const JUDGEMENT_NOT_NEEDED = '- 人の判断: 不要'
const BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	JUDGEMENT_NOT_NEEDED,
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	`- 実施可能条件: #${String(CITED)} のマージ後 30 マージ`,
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')

// joshuafolkken/kit#4901: a measurement follow-up — no file to change, a criterion reading
// `lane:stats` about a cited change — with no start condition at all.
const measurement_path = path.join(work, 'measurement.md')
const MEASUREMENT_BACKGROUND = [
	'## 背景',
	'',
	'- 種別: 非不具合',
	JUDGEMENT_NOT_NEEDED,
	'- 規模見積もり: 約 0 ファイル / 0 行（テスト除く）',
]
const MEASUREMENT_REST =
	'\n## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] #4896 後の `pnpm josh lane:stats` の中央値を記録する\n'
const MEASUREMENT_BODY = [...MEASUREMENT_BACKGROUND, MEASUREMENT_REST].join('\n')

// joshuafolkken/kit#5051: the same follow-up, citing the issue whose closing pull request it waits on.
const closing_path = path.join(work, 'closing.md')
const CLOSING_CONDITION = `- 実施可能条件: #${String(CITED)} を閉じる PR のマージ後 10 マージ`

writeFileSync(
	closing_path,
	[...MEASUREMENT_BACKGROUND, CLOSING_CONDITION, MEASUREMENT_REST].join('\n'),
)
writeFileSync(measurement_path, MEASUREMENT_BODY)
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
	vi.spyOn(issue_closing_pr, 'read_closing_number').mockResolvedValue(CLOSING)
	exec_gh_api.mockResolvedValue(JSON.stringify({ number: CITED }))
	vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
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

describe('issue_file_cli.run — a measurement follow-up with no start condition', () => {
	it('refuses the filing with the declaration line, before any read or create', async () => {
		expect(await issue_file_cli.run(argv_of(measurement_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(issue_sample_gate.DECLARATION)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('issue_file_cli.run — a start condition citing an issue', () => {
	it('refuses the filing, citing the pull request that closed the issue', async () => {
		expect(await issue_file_cli.run(argv_of(body_path))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(`#${String(CLOSING)}`)
		expect(exec_gh_api).toHaveBeenCalledTimes(1)
	})

	it('reads the number in the target repository', async () => {
		expect(await issue_file_cli.run(argv_of(origin_path, '--repo', THERE))).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).toHaveBeenCalledWith({
			path: git_gh_api_path.issue_api_path(String(CITED), THERE),
		})
	})
})

// joshuafolkken/kit#5051: a lane files its measurement follow-up before the pull request closing its
// issue exists — `josh ship` wants the deferral row first — by citing the issue's closing pull request.
describe('issue_file_cli.run — a measurement follow-up citing the closing pull request of an issue', () => {
	it('passes the start condition checks unread and reaches the scout', async () => {
		await issue_file_cli.run(argv_of(closing_path, '--label', 'run:lane'))

		expect(vi.mocked(console.error).mock.calls.join('\n')).not.toContain('実施可能条件')
		expect(scout).toHaveBeenCalledTimes(1)
		expect(exec_gh_api).not.toHaveBeenCalledWith({
			path: git_gh_api_path.issue_api_path(String(CITED)),
		})
	})
})
