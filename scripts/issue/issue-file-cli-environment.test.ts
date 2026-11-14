import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'

const HERE = 'joshuafolkken/kit'
const THERE = 'joshuafolkken/app-kit'
const KEY = 'GH_REPO'
const SUCCESS = 0
const FAILURE = 1
const ISSUE_NUMBER = 2900
const ISSUE_URL = `https://github.com/${THERE}/issues/${String(ISSUE_NUMBER)}`
const CLEAR = { report: 'Duplicates: none', candidates: [] }
const ERROR = new Error('scout failed')
const work = temporary_directory('suite')('issue-file-environment-')
const body_file = path.join(work, 'origin.md')
const ARGV = ['Restore the filing environment', '--body-file', body_file, '--repo', THERE]
const MODES = ['run', 'file_issue', 'check', 'scout'] as const
type Mode = (typeof MODES)[number]

writeFileSync(
	body_file,
	[
		'## 背景',
		'- 種別: 不具合',
		'- 原因: #4201',
		'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
		'- 人の判断: 不要',
		'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z',
		`## Origin\n\n${HERE}#2808`,
	].join('\n\n'),
)

const scout = vi.spyOn(issue_scout_cli, 'scout')
const place = vi.spyOn(epic_bundle_cli, 'report_for')
const create = vi.spyOn(git_gh_exec, 'exec_gh_api')

vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)

async function invoke(mode: Mode): Promise<unknown> {
	if (mode === 'check') return await issue_file_cli.run([...ARGV, '--check'])

	return await issue_file_cli[mode](ARGV)
}

function success_of(mode: Mode): unknown {
	if (mode === 'scout') return CLEAR

	return mode === 'file_issue' ? ISSUE_URL : SUCCESS
}

function refusal_of(mode: Mode): unknown {
	return mode === 'run' || mode === 'check' ? FAILURE : undefined
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue('joshuafolkken')
	vi.stubEnv(issue_wip.WIP_CAP_KEY, '')
	create.mockResolvedValue(ISSUE_URL)
	scout.mockImplementation(async () => {
		expect(process.env[KEY]).toBe(THERE)

		return CLEAR
	})
	place.mockImplementation(async () => {
		expect(process.env[KEY]).toBe(THERE)

		return SUCCESS
	})
})

afterEach(() => {
	vi.unstubAllEnvs()
})

afterAll(() => {
	vi.restoreAllMocks()
})

// joshuafolkken/kit#7430: the caller may inherit an empty value as well as a repository or no key.
describe.each([undefined, '', HERE])('filing with original GH_REPO=%j', (original) => {
	beforeEach(() => {
		vi.stubEnv(KEY, original)
	})

	it.each(MODES)('%s restores the environment after success', async (mode) => {
		expect(await invoke(mode)).toStrictEqual(success_of(mode))
		expect(process.env[KEY]).toBe(original)
		expect(Object.hasOwn(process.env, KEY)).toBe(original !== undefined)
		expect(scout).toHaveBeenCalledExactlyOnceWith(expect.anything(), THERE)

		if (mode === 'run' || mode === 'file_issue') {
			expect(place).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, THERE)
		}
	})

	it.each(MODES)('%s restores the environment after refusal', async (mode) => {
		scout.mockImplementation(async () => {
			expect(process.env[KEY]).toBe(THERE)

			return undefined
		})

		expect(await invoke(mode)).toBe(refusal_of(mode))
		expect(process.env[KEY]).toBe(original)
		expect(Object.hasOwn(process.env, KEY)).toBe(original !== undefined)
		expect(create).not.toHaveBeenCalled()
	})

	it.each(MODES)('%s restores the environment after an exception', async (mode) => {
		scout.mockRejectedValue(ERROR)

		await expect(invoke(mode)).rejects.toThrow(ERROR)
		expect(process.env[KEY]).toBe(original)
		expect(Object.hasOwn(process.env, KEY)).toBe(original !== undefined)
	})
})

describe.each([undefined, '', HERE])('placement with original GH_REPO=%j', (original) => {
	beforeEach(() => {
		vi.stubEnv(KEY, original)
	})

	it('restores the environment when placement throws after creation', async () => {
		place.mockRejectedValue(ERROR)

		await expect(issue_file_cli.file_issue(ARGV)).rejects.toThrow(ERROR)
		expect(create).toHaveBeenCalledOnce()
		expect(process.env[KEY]).toBe(original)
	})

	it('keeps the target through placement with a precomputed scout', async () => {
		expect(await issue_file_cli.file_issue(ARGV, CLEAR)).toBe(ISSUE_URL)
		expect(place).toHaveBeenCalledExactlyOnceWith(ISSUE_NUMBER, THERE)
		expect(scout).not.toHaveBeenCalled()
		expect(process.env[KEY]).toBe(original)
	})
})
