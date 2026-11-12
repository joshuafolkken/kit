import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_sample_source } from './issue-sample-source'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'

// joshuafolkken/kit#5191: `josh issue:file` prints every local refusal in one call — the body lint and
// the run label an `auto-ok` filing owes — so one reissue fixes them all, and it files nothing while any
// remains. joshuafolkken/kit#5833: the GitHub reads run in the same pass, and `--check` files nothing.

const HERE = 'joshuafolkken/kit'
const DUPLICATE = 2801
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const CHECK_FLAG = '--check'

const make_directory = temporary_directory('suite')
const work = make_directory('issue-file-cli-one-pass-')
const body_path = path.join(work, 'refused-thrice.md')

// Opted into `auto-ok` with no run label named, and missing every section after the background; its
// start condition's GitHub read is stubbed, so `exec_gh_api` sees only a create call.
writeFileSync(
	body_path,
	'## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n- 実施可能条件: #4442 のマージ後 30 マージ\n',
)

function argv_of(path_of_body: string): Array<string> {
	return ['A title', '--body-file', path_of_body]
}

const ARGV = argv_of(body_path)

// Every local check passes: a judgement-needed body is not opted into `auto-ok`, so it owes no run label.
const clear_path = path.join(work, 'locally-clear.md')

writeFileSync(
	clear_path,
	[
		'## 背景',
		'',
		'- 種別: 不具合',
		'- 原因: #4201',
		'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
		'- 人の判断: 要（目視確認）',
		'',
		'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
	].join('\n'),
)
const CLEAR_ARGV = argv_of(clear_path)

// Stubbed so a regression that lets the filing through never reaches a real create.
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')

function scout_finds_none(): void {
	vi.mocked(issue_scout_cli.scout).mockResolvedValue({ report: 'Duplicates: none', candidates: [] })
}

beforeEach(() => {
	exec_gh_api.mockResolvedValue('https://github.com/joshuafolkken/kit/issues/1')
	vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
	vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
})

// The GitHub reads the pass makes, each answering without a network call.
beforeEach(() => {
	vi.spyOn(issue_sample_source, 'problem').mockResolvedValue(undefined)
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({
		report: 'Duplicates: 1',
		candidates: [DUPLICATE],
	})
})

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	vi.restoreAllMocks()
})

describe('issue_file_cli.run — every refusal in one pass', () => {
	it('prints the lint and the run label in one call', async () => {
		expect(await issue_file_cli.run(ARGV)).toBe(FAILURE_EXIT_CODE)
		const printed = vi.mocked(console.error).mock.calls.join('\n')

		for (const refusal of ['## 現象', '--label run:solo']) {
			expect(printed).toContain(refusal)
		}
	})

	it('runs the scout while a local refusal stands, and files nothing', async () => {
		await issue_file_cli.run(ARGV)

		expect(issue_scout_cli.scout).toHaveBeenCalledOnce()
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('--distinct')
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('holds a body the local checks pass on the scout candidates', async () => {
		expect(await issue_file_cli.run(CLEAR_ARGV)).toBe(FAILURE_EXIT_CODE)
		const printed = vi.mocked(console.error).mock.calls.join('\n')

		expect(issue_scout_cli.scout).toHaveBeenCalledOnce()
		expect(printed).toContain(`--distinct ${String(DUPLICATE)}`)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#7201: a malformed cap is refused by name, never counted against the default.
	it('refuses a malformed JOSH_WIP_CAP by name, and files nothing', async () => {
		scout_finds_none()
		vi.stubEnv(issue_wip.WIP_CAP_KEY, 'thirty')

		expect(await issue_file_cli.run(CLEAR_ARGV)).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(issue_wip.WIP_CAP_KEY)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

describe('issue_file_cli.run — --check', () => {
	it('exits 1 on a refusal and creates nothing', async () => {
		expect(await issue_file_cli.run([...ARGV, CHECK_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(issue_scout_cli.scout).toHaveBeenCalledOnce()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('exits 0 when no step refuses, and creates nothing', async () => {
		scout_finds_none()

		expect(await issue_file_cli.run([...CLEAR_ARGV, CHECK_FLAG])).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain('nothing filed')
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(repository_labels.ensure_labels).not.toHaveBeenCalled()
	})

	// joshuafolkken/kit#6733: a body `josh pr` could not classify is refused before it is filed.
	it('refuses a body that resolves to more than one release classification', async () => {
		const several_path = path.join(work, 'several-classifications.md')

		writeFileSync(several_path, `- リリース分類: enhancement\n${readFileSync(clear_path, 'utf8')}`)
		scout_finds_none()

		expect(await issue_file_cli.run([...argv_of(several_path), CHECK_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			'Choose one release classification',
		)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('answers no URL from file_issue', async () => {
		scout_finds_none()

		expect(await issue_file_cli.file_issue([...CLEAR_ARGV, CHECK_FLAG])).toBeUndefined()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#6733: a non-bug body with no aim is filed with the `other-change` line `josh pr`
// reads, unless a `--label` already classifies it — and judged with that label.
describe('issue_file_cli.run — the other-change completion', () => {
	const non_bug_path = path.join(work, 'non-bug.md')
	const OTHER_CHANGE_LINE = '- リリース分類: other-change'
	const IGNORE_LABEL = ['--label', 'ignore-for-release']
	const non_bug_body = readFileSync(clear_path, 'utf8').replace(
		'- 種別: 不具合\n- 原因: #4201',
		'- 種別: 非不具合',
	)

	writeFileSync(non_bug_path, non_bug_body)

	// The create call is refused, so the run stops at the body it sent, before any post-filing read.
	beforeEach(() => {
		scout_finds_none()
		exec_gh_api.mockRejectedValue(new Error('HTTP 502'))
	})

	it('writes the line into the filed body', async () => {
		await issue_file_cli.file_issue(argv_of(non_bug_path))

		expect(JSON.stringify(exec_gh_api.mock.calls)).toContain(OTHER_CHANGE_LINE)
	})

	it('leaves the body alone when a --label classifies it', async () => {
		await issue_file_cli.file_issue([...argv_of(non_bug_path), ...IGNORE_LABEL])

		expect(exec_gh_api).toHaveBeenCalled()
		expect(JSON.stringify(exec_gh_api.mock.calls)).not.toContain(OTHER_CHANGE_LINE)
	})

	it('refuses a declaration a --label classification contradicts', async () => {
		const labelled_path = path.join(work, 'labelled-non-bug.md')

		writeFileSync(labelled_path, `${OTHER_CHANGE_LINE}\n${non_bug_body}`)
		const argv = [...argv_of(labelled_path), ...IGNORE_LABEL, CHECK_FLAG]

		expect(await issue_file_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			'ignore-for-release, other-change',
		)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})

// `upstream:interrupt` reads the URL `file_issue` answers, so a failed create answers none.
describe('issue_file_cli.file_issue — a create call that fails', () => {
	it('answers no URL, and run exits 1', async () => {
		scout_finds_none()
		exec_gh_api.mockRejectedValue(new Error('HTTP 502'))

		expect(await issue_file_cli.file_issue(CLEAR_ARGV)).toBeUndefined()
		expect(await issue_file_cli.run(CLEAR_ARGV)).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('the create call failed')
	})
})
