import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { repo_party } from '#scripts/discovery/repo-party'
import { epic_bundle_cli } from '#scripts/epic/epic-bundle-cli'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { git_gh_issue_list } from '#scripts/gh/git-gh-issue-list'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { repository_labels } from '#scripts/repo/repository-labels'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { issue_file_cap } from './issue-file-cap'
import { issue_file_cli } from './issue-file-cli'
import { issue_file_fold } from './issue-file-fold'
import { issue_file_interrupt } from './issue-file-interrupt'
import { issue_publication_state } from './issue-publication-state'
import { issue_scout_cli } from './issue-scout-cli'
import { issue_wip } from './issue-wip'

// joshuafolkken/kit#8542: a prepared child a lane child files records the lane's run Issue as its
// origin, so that lane's ship publishes or refuses it; a filing outside a lane records none.

const HERE = 'joshuafolkken/kit'
const OWNER = 'joshuafolkken'
const LANE_ISSUE = '8474'
const LANE_ISSUE_NUMBER = 8474
const ISSUE_URL = `https://github.com/${HERE}/issues/2900`
const BODY = [
	'## 概要\n\n要約\n',
	'## 背景',
	'',
	'- 種別: 不具合',
	'- 原因: #4201',
	'- 規模見積もり: 約 1 ファイル / 10 行（テスト除く）',
	'- 人の判断: 不要',
	'',
	'## 現象\n\nx\n\n## 期待結果\n\ny\n\n## 受け入れ条件\n\n- [ ] z\n',
].join('\n')

const body_path = path.join(temporary_directory('suite')('issue-file-cli-origin-'), 'child.md')

writeFileSync(body_path, BODY)

const exec_gh_api = vi.spyOn(git_gh_exec, 'exec_gh_api')
const is_child_of = vi.spyOn(lane_child_marker, 'is_child_of')

vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(LANE_ISSUE)
vi.spyOn(run_event_stream_emit, 'emit').mockResolvedValue()
vi.spyOn(issue_file_fold, 'is_fold_clear').mockResolvedValue(true)
vi.spyOn(issue_file_cap, 'is_cap_clear').mockResolvedValue(true)
vi.spyOn(issue_file_interrupt, 'block_finder').mockResolvedValue()
vi.spyOn(console, 'info').mockImplementation(() => undefined)
vi.spyOn(console, 'error').mockImplementation(() => undefined)

const sent_schema = z.object({ body: z.string() })

async function filed_body(): Promise<string> {
	const argv = ['Split child', '--body-file', body_path, '--label', 'run:lane', '--prepare']

	expect(await issue_file_cli.run(argv)).toBe(0)

	return sent_schema.parse(JSON.parse(exec_gh_api.mock.calls[0]?.[0].body ?? '{}')).body
}

beforeEach(() => {
	exec_gh_api.mockReset()
	vi.spyOn(git_gh_command, 'repo_get_name_with_owner').mockResolvedValue(HERE)
	vi.spyOn(repo_party, 'current_owner').mockReturnValue(OWNER)
	vi.spyOn(issue_scout_cli, 'scout').mockResolvedValue({
		report: 'Duplicates: none',
		candidates: [],
	})
	vi.spyOn(epic_bundle_cli, 'report_for').mockResolvedValue(0)
	vi.spyOn(repository_labels, 'ensure_labels').mockReturnValue([])
	vi.spyOn(git_gh_issue_list, 'issue_list').mockResolvedValue({ json: '[]', is_capped: false })
	vi.stubEnv(issue_wip.WIP_CAP_KEY, '')
	exec_gh_api.mockResolvedValue(ISSUE_URL)
})

afterAll(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
})

describe('issue_file_cli.run --prepare — the origin of a prepared child', () => {
	it('records the lane run Issue when a lane child files it', async () => {
		is_child_of.mockReturnValue(true)

		expect(issue_publication_state.origin_of(await filed_body())).toBe(LANE_ISSUE_NUMBER)
	})

	it('records no origin outside a lane, still prepared', async () => {
		is_child_of.mockReturnValue(false)
		const body = await filed_body()

		expect(issue_publication_state.is_pending(body)).toBe(true)
		expect(issue_publication_state.origin_of(body)).toBeUndefined()
	})
})
