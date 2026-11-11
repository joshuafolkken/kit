import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { UNORDERED_DEPENDENCIES } from '#scripts/epic/epic-parse'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { temporary_directory } from '#tools/test/temporary-directory'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_cap_files } from './issue-cap-files'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#5985: the filing asks the split direction among its holds, so an independent split
// the kept Issue's criteria depend on is refused before anything is created. The direction's answers
// are `split-direction.test.ts`'s; here only the filing's wiring is asserted.

const HERE = 'joshuafolkken/kit'
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const KEPT = '5953'
const RELAY = 'scripts/run/entry/run-entry-cli.ts'
const BODY_FLAG = '--body-file'
const FINDER_FLAG = '--found-during'
const KEPT_BODY = '## 受け入れ条件\n\n- [ ] `run-entry-cli.ts` が中継する\n'
const FILING_PASSED = 'every filing step passed'

const make_directory = temporary_directory('suite')
const work = make_directory('issue-file-cli-split-')
const body_path = path.join(work, 'body.md')

writeFileSync(
	body_path,
	[
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 人の判断: 要（目視確認）',
		'- 規模見積もり: 約 6 ファイル / 120 行（テスト除く）',
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
	// The body names a real file; counting it would start ESLint.
	vi.spyOn(issue_cap_files, 'near_cap').mockResolvedValue([])
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({
		report: 'Duplicates: none',
		candidates: [],
	})
	vi.spyOn(git_gh_command, 'issue_get_labels_and_body').mockResolvedValue(
		JSON.stringify({ number: Number(KEPT), labels: [], body: KEPT_BODY }),
	)
})

async function prerequisite_flags(argv: ReadonlyArray<string>): Promise<Array<string>> {
	expect(await issue_file_cli.run([...argv, '--route', 'split'])).toBe(FAILURE_EXIT_CODE)
	const guidance = vi.mocked(console.error).mock.calls.join('\n')

	vi.mocked(console.error).mockClear()

	return /--route split --label route:tier-a/u.exec(guidance)?.[0].split(' ') ?? []
}

describe('issue_file_cli.run — promoted epic split children', () => {
	it.each(['epic', 'Epic'])(
		'admits a child implementing its %s criteria (ac-0b659892)',
		async (label: string) => {
			const body = `${KEPT_BODY}\n## Tasks\n\n- [ ] #6464\n\n## Dependencies\n\n${UNORDERED_DEPENDENCIES}\n`

			vi.mocked(git_gh_command.issue_get_labels_and_body).mockResolvedValue(
				JSON.stringify({ number: Number(KEPT), labels: [{ name: label }], body }),
			)
			const argv = [
				'A title',
				BODY_FLAG,
				body_path,
				'--route',
				'split',
				FINDER_FLAG,
				KEPT,
				'--check',
			]

			expect(await issue_file_cli.run(argv)).toBe(SUCCESS_EXIT_CODE)
			expect(vi.mocked(console.info).mock.calls.join('\n')).toContain(FILING_PASSED)
			expect(console.error).not.toHaveBeenCalled()
			expect(exec_gh_api).not.toHaveBeenCalled()
		},
	)

	it('keeps direction protection for a label without an epic body', async () => {
		vi.mocked(git_gh_command.issue_get_labels_and_body).mockResolvedValue(
			JSON.stringify({ number: Number(KEPT), labels: [{ name: 'epic' }], body: KEPT_BODY }),
		)
		const argv = ['A title', BODY_FLAG, body_path, '--route', 'split', FINDER_FLAG, KEPT, '--check']

		expect(await issue_file_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('prerequisite')
	})
})

describe('issue_file_cli.run — the split direction', () => {
	it('admits the same large prerequisite as a split without opposing route demands (ac-7717358b)', async () => {
		const argv = ['A title', BODY_FLAG, body_path, FINDER_FLAG, KEPT, '--check']

		expect(await issue_file_cli.run([...argv, '--route', 'tier-a'])).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('--route split')
		vi.mocked(console.error).mockClear()
		const flags = await prerequisite_flags(argv)

		expect(flags).not.toEqual([])
		expect(await issue_file_cli.run([...argv, ...flags])).toBe(SUCCESS_EXIT_CODE)
		expect(vi.mocked(console.info).mock.calls.join('\n')).toContain(FILING_PASSED)
		expect(console.error).not.toHaveBeenCalled()
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('refuses a split child whose kept Issue names its module, before any create (ac-946c6d9d)', async () => {
		const argv = ['A title', BODY_FLAG, body_path, '--route', 'split', FINDER_FLAG, KEPT]

		expect(await issue_file_cli.run(argv)).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
			`run:split ${KEPT} --prerequisite`,
		)
	})
})
