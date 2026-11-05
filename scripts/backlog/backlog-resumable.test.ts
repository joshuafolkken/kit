import type { EpicChild } from '#scripts/epic/epic-graph'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_stash } from '#scripts/git/stash/git-stash'
import { issue_closing_pr } from '#scripts/issue/issue-closing-pr'
import { run_pause_comment } from '#scripts/run/pause/run-pause-comment'
import { beforeEach, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_resumable } from './backlog-resumable'

const ISSUE = 901
const STASH_ERROR = 'git failed'

function child(repo: string): EpicChild {
	return { number: ISSUE, repo, state: 'OPEN', labels: [], blocked_by: [] }
}

function result(): EpicNextResult {
	return {
		verdict: 'run',
		candidates: [{ repo: backlog_fixture.REPO, children: [] }],
		waiting: [child(backlog_fixture.REPO), child('someone/other')],
		blocked_on_people: [],
		anomalies: [],
	}
}

beforeEach(() => {
	vi.restoreAllMocks()
	backlog_fixture.stub_backlog({ stashed: [ISSUE] })
})

it('keeps resume information for later waves without reading foreign issues', async () => {
	const enriched = await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(enriched.waiting.map((row) => row.is_resumable)).toEqual([true, undefined])
	expect(git_stash.list).toHaveBeenCalledTimes(1)
})

it('refuses an unreadable stash list instead of treating it as empty', async () => {
	vi.mocked(git_stash.list).mockRejectedValue(new Error(STASH_ERROR))

	await expect(backlog_resumable.read(result(), backlog_fixture.REPO)).rejects.toThrow(STASH_ERROR)
})

it('reads only local pause and PR signals when there is no stash', async () => {
	backlog_fixture.stub_backlog({ open_pr: [ISSUE] })
	const enriched = await backlog_resumable.read(result(), backlog_fixture.REPO)

	expect(enriched.waiting.map((row) => row.is_resumable)).toEqual([true, undefined])
	expect(run_pause_comment.is_paused).toHaveBeenCalledExactlyOnceWith(String(ISSUE))
	expect(issue_closing_pr.has_open_pr).toHaveBeenCalledExactlyOnceWith(String(ISSUE))
})

it.each(['pause', 'PR'])('propagates an unreadable %s signal', async (signal) => {
	backlog_fixture.stub_backlog({})
	const reader = signal === 'pause' ? run_pause_comment.is_paused : issue_closing_pr.has_open_pr

	vi.mocked(reader).mockRejectedValue(new Error(STASH_ERROR))

	await expect(backlog_resumable.read(result(), backlog_fixture.REPO)).rejects.toThrow(STASH_ERROR)
})
