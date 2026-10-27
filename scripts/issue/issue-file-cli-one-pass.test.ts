import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#5191: `josh issue:file` prints every refusal the caller answers from the body and
// the arguments in one call — the body lint, the run label an `auto-ok` filing owes and the duplicate
// candidates — so one reissue fixes them all, and it files nothing while any remains.

const HERE = 'joshuafolkken/kit'
const DUPLICATE = 2801
const FAILURE_EXIT_CODE = 1

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-one-pass-'))
const body_path = path.join(work, 'refused-thrice.md')

// Opted into `auto-ok` with no run label named, and missing every section after the background.
writeFileSync(body_path, '## 背景\n\n- 種別: 不具合\n- 人の判断: 不要\n')
const ARGV = ['A title', '--body-file', body_path]

// Stubbed so a regression that lets the filing through never reaches a real create.
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')

beforeEach(() => {
	exec_gh_api.mockResolvedValue('https://github.com/joshuafolkken/kit/issues/1')
	vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
	vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({
		report: 'Duplicates: 1',
		candidates: [DUPLICATE],
	})
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_cli.run — every refusal in one pass', () => {
	it('prints the lint, the run label and the duplicate candidates in one call', async () => {
		expect(await issue_file_cli.run(ARGV)).toBe(FAILURE_EXIT_CODE)
		const printed = vi.mocked(console.error).mock.calls.join('\n')

		for (const refusal of ['## 現象', '--label run:solo', `--distinct ${String(DUPLICATE)}`]) {
			expect(printed).toContain(refusal)
		}
	})

	it('files nothing while any refusal remains', async () => {
		await issue_file_cli.run(ARGV)

		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})
