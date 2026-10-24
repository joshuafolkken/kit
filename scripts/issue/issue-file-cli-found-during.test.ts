import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_deferral } from './issue-file-deferral'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'

// The wiring of the origin `josh issue:file --found-during` names.
// joshuafolkken/kit#4750: the filing asks the cap first, for that origin. The count itself is
// `issue-file-cap.test.ts`'s; here only the filing's wiring is asserted.
// joshuafolkken/kit#4762: the same origin is never held as its own duplicate candidate.

const HERE = 'joshuafolkken/kit'
const FAILURE_EXIT_CODE = 1
const FOUND_DURING_FLAG = '--found-during'
const ORIGIN = 4717
const HELD_MESSAGE = 'duplicate candidate'

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-cli-found-during-'))
const body_path = path.join(work, 'body.md')

writeFileSync(
	body_path,
	[
		'## 背景',
		'',
		'- 種別: 非不具合',
		'- 人の判断: 要（目視確認）',
		'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
		'',
		'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
	].join('\n'),
)

function argv_of(...extra: ReadonlyArray<string>): Array<string> {
	return ['A title', '--body-file', body_path, ...extra]
}

// The scout answers nothing, so a filing the cap lets through stops there, before any create.
const scout = vi.spyOn(issue_scout_cli, 'scout')
const cap_clear = vi.spyOn(issue_file_cap, 'is_cap_clear')
const fold_clear = vi.spyOn(issue_file_fold, 'is_fold_clear')
const issue_list = vi.spyOn(git_gh_issue_list, 'issue_list')
const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	cap_clear.mockResolvedValue(true)
	fold_clear.mockResolvedValue(true)
	issue_list.mockResolvedValue({ json: undefined, is_capped: false })
	scout.mockResolvedValue(undefined)
})

afterEach(() => {
	vi.clearAllMocks()
})

afterAll(() => {
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_cli.run — the filing cap', () => {
	it('asks the cap for the origin --found-during names', async () => {
		await issue_file_cli.run(argv_of(FOUND_DURING_FLAG, '#77'))

		expect(cap_clear).toHaveBeenCalledExactlyOnceWith('77')
		expect(fold_clear).toHaveBeenCalledOnce()
	})

	it('holds a filing over the cap before the fold or the backlog is read', async () => {
		cap_clear.mockResolvedValue(false)

		expect(await issue_file_cli.run(argv_of())).toBe(FAILURE_EXIT_CODE)
		expect(cap_clear).toHaveBeenCalledOnce()
		for (const step of [fold_clear, issue_list, scout]) expect(step).not.toHaveBeenCalled()
	})

	it('names --found-during in the usage a malformed call prints', async () => {
		expect(await issue_file_cli.run(argv_of(FOUND_DURING_FLAG, 'x'))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('[--found-during <N>]')
	})

	// joshuafolkken/kit#4768: `--blocks-finder` records that origin as blocked by the filed interrupt.
	it('names --blocks-finder in the usage a malformed call prints', async () => {
		expect(await issue_file_cli.run(argv_of(FOUND_DURING_FLAG, 'x'))).toBe(FAILURE_EXIT_CODE)
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain('[--blocks-finder]')
	})
})

describe('issue_file_cli.run — the --found-during origin as a scout candidate', () => {
	// The create answers no URL, so a filing the scout lets through fails there, after one call.
	beforeEach(() => {
		scout.mockResolvedValue({ report: 'Duplicates: 1', candidates: [ORIGIN] })
		vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
		vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
		vi.spyOn(issue_file_deferral, 'note_finder').mockResolvedValue()
		exec_gh_api.mockResolvedValue('')
	})

	it('goes on to the create past the origin it names', async () => {
		await issue_file_cli.run(argv_of(FOUND_DURING_FLAG, String(ORIGIN)))

		expect(exec_gh_api).toHaveBeenCalledOnce()
		expect(vi.mocked(console.error).mock.calls.join('\n')).not.toContain(HELD_MESSAGE)
	})

	it('still holds the same candidate when no origin is named', async () => {
		expect(await issue_file_cli.run(argv_of())).toBe(FAILURE_EXIT_CODE)
		expect(exec_gh_api).not.toHaveBeenCalled()
		expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(HELD_MESSAGE)
	})
})
