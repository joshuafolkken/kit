import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_batch } from './issue-file-batch'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'

// joshuafolkken/kit#5660: `josh issue:file --batch <dir>` files every body file in one call through
// the whole filing, and a body a step refuses stays unfiled while the rest are filed. The network
// reads are stubbed at the namespaces the filing calls, as in `issue-file-cli.test.ts`.

const HERE = 'joshuafolkken/kit'
const OWNER = 'joshuafolkken'
const ISSUE_URL = `https://github.com/${HERE}/issues/2900`
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const BATCH_FLAG = '--batch'
const FIRST = 'First filing'
const SECOND = 'Second filing'
const THIRD = 'Third filing'
const VALID_BODY = [
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	'- 人の判断: 要（目視確認）',
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')
const INVALID_BODY = '## 背景\n'

interface CreateRequest {
	title: string
}

const work = mkdtempSync(path.join(tmpdir(), 'issue-file-batch-'))

const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const info = vi.spyOn(console, 'info')

vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({ report: 'Duplicates: none', candidates: [] })
vi.spyOn(epic_bundle_cli, 'report_for').mockResolvedValue(SUCCESS_EXIT_CODE)
vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)

// A batch directory holding one body file per `[title, body]` pair, named in order.
function batch_of(name: string, bodies: ReadonlyArray<readonly [string, string]>): string {
	const directory = mkdtempSync(path.join(work, `${name}-`))

	for (const [index, [title, body]] of bodies.entries()) {
		writeFileSync(path.join(directory, `${String(index)}.md`), `---\ntitle: ${title}\n---\n${body}`)
	}

	return directory
}

function requests(): Array<unknown> {
	return exec_gh_api.mock.calls.map((call): unknown => JSON.parse(call[0].body ?? '{}'))
}

// The create requests to expect, one per title, in filing order.
function filed(...titles: ReadonlyArray<string>): Array<CreateRequest> {
	return titles.map((title) => ({ title }))
}

beforeEach(() => {
	info.mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue(OWNER)
	exec_gh_api.mockResolvedValue(ISSUE_URL)
})

afterEach(() => {
	vi.clearAllMocks()
	Reflect.deleteProperty(process.env, 'GH_REPO')
})

afterAll(() => {
	vi.restoreAllMocks()
	rmSync(work, { recursive: true, force: true })
})

describe('issue_file_batch.run — several body files in one call', () => {
	it('files three body files in one call', async () => {
		const directory = batch_of('three', [
			[FIRST, VALID_BODY],
			[SECOND, VALID_BODY],
			[THIRD, VALID_BODY],
		])

		expect(await issue_file_batch.run([BATCH_FLAG, directory])).toBe(SUCCESS_EXIT_CODE)
		expect(requests()).toMatchObject(filed(FIRST, SECOND, THIRD))
		expect(info).toHaveBeenCalledWith(expect.stringContaining('filed 3 of 3'))
	})

	it('files the other two when the lint refuses one, and prints the refused one', async () => {
		const directory = batch_of('refused', [
			[FIRST, VALID_BODY],
			[SECOND, INVALID_BODY],
			[THIRD, VALID_BODY],
		])

		expect(await issue_file_batch.run([BATCH_FLAG, directory])).toBe(FAILURE_EXIT_CODE)
		expect(requests()).toMatchObject(filed(FIRST, THIRD))
		expect(info).toHaveBeenCalledWith(
			expect.stringMatching(/filed 2 of 3[\s\S]*✖ refused: .*1\.md — Second filing/u),
		)
	})

	it('appends the shared flags to every filing', async () => {
		const directory = batch_of('shared', [[FIRST, VALID_BODY]])

		await issue_file_batch.run([BATCH_FLAG, directory, '--route', 'tier-a'])

		expect(requests()).toMatchObject([{ labels: ['route:tier-a', 'bug'] }])
	})
})

describe('issue_file_batch.run — the arguments around --batch', () => {
	it('answers is_batch only for an argument list carrying --batch', () => {
		expect(issue_file_batch.is_batch([BATCH_FLAG, work])).toBe(true)
		expect(issue_file_batch.is_batch(['Title', '--body-file', 'b.md'])).toBe(false)
	})

	it('refuses --batch with no directory, and a directory that cannot be read', async () => {
		expect(await issue_file_batch.run([BATCH_FLAG])).toBe(FAILURE_EXIT_CODE)
		expect(await issue_file_batch.run([BATCH_FLAG, path.join(work, 'missing')])).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(exec_gh_api).not.toHaveBeenCalled()
	})

	it('refuses a directory holding no .md body file', async () => {
		const directory = batch_of('empty', [])

		expect(await issue_file_batch.run([BATCH_FLAG, directory])).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining('no *.md body files'))
		expect(exec_gh_api).not.toHaveBeenCalled()
	})
})
